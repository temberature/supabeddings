

import { createClient } from '@supabase/supabase-js'
import BOOKMARKS from './constants/bookmarks.mjs'
// import type { Database } from './types/supabase'
import md5 from 'md5'
import { OpenAI } from 'openai'

import { HttpsProxyAgent } from 'https-proxy-agent';
import fetch from 'node-fetch';
// Import the entire module as a default import
import gpt3Encoder from 'gpt-3-encoder';
import { stripIndent } from 'common-tags';
import { oneLine } from 'common-tags';

import dotenv from 'dotenv';
dotenv.config();

const proxyUrl = 'http://127.0.0.1:8118'; // 代理服务器地址
const proxyAgent = new HttpsProxyAgent(proxyUrl);

const supabaseUrl = process.env.supabaseUrl
const openAIKey = process.env.openAIKey
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY

// console.log(process.env.SUPABASE_SERVICE_KEY);
// Create a single supabase client for interacting with your database
const supabase = createClient(supabaseUrl, SUPABASE_SERVICE_KEY)
const openai = new OpenAI({ apiKey: openAIKey })

BOOKMARKS.forEach(async (bookmark, index) => {
    const content = bookmark.title + ' ' + bookmark.excerpt
    // const embeddingResponse = await openai.embeddings.create({
    //     model: "text-embedding-ada-002",
    //     input: content,
    // })

    // const embedding = embeddingResponse.data[0].embedding
    const currentMd5 = md5(content)
    const { data: selectedData, error: selectedError } = await supabase
        .from('documents')
        .select()
        .eq('checksum', currentMd5)
        .single()

    if (selectedData) {
        console.log(index)
        return
    }
    const embeddingResponse = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${openAIKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            input: content,
            model: "text-embedding-ada-002",
        }),
        agent: proxyAgent,
        signal: AbortSignal.timeout(10000),
    });
    const responseJson = (await embeddingResponse.json());
    const embedding = responseJson.data[0].embedding;


    const generateContentMd5 = (content) => {
        const md5Hash = md5(content)
        return md5Hash
    }

    const bookmarkData = {
        title: bookmark.title,
        url: bookmark.link,
        description: bookmark.excerpt ?? "",
        checksum: generateContentMd5(content),
        content,
        embedding,
    }

    const { data, error } = await supabase
        .from('documents')
        //@ts-ignore
        .insert(bookmarkData)
        .single()
})

async function askEmbedding(question) {
    const embeddingResponse = await openai.embeddings.create({
        model: "text-embedding-ada-002",
        input: question,
    }, {
        proxy: false,
        httpAgent: proxyAgent,
        httpsAgent: proxyAgent
    })

    const embedding = embeddingResponse.data[0].embedding
    console.log(embedding);
    const { data: documents } = await supabase.rpc('match_documents', {
        //@ts-ignore
        query_embedding: embedding,
        match_threshold: 0.78, // Choose an appropriate threshold for your data
        match_count: 10, // Choose the number of matches
    })

    return documents
}


askEmbedding("书签").then((data) => {
    console.log(data)
})

async function askGPT(question) {
    const documents = await askEmbedding(question);

    if (!documents || documents.length === 0) {
        return;
    }

    // Destructure encode and decode functions
    const { encode, decode } = gpt3Encoder;
    let tokenCount = 0;
    let contextText = '';

    // Concat matched documents
    for (let i = 0; i < documents.length; i++) {
        const document = documents[i];
        const content = document.content;
        const encoded = encode(content);
        tokenCount += encoded.length;  // Note: Adjusted to use the length of encoded integers

        // Limit context to max 1500 tokens (configurable)
        if (tokenCount > 1500) {
            break;
        }

        contextText += `${content.trim()}\n---\n`;
    }

    const prompt = stripIndent`${oneLine`
    你是一个书签管理员，你的工作是帮助用户找到他们想要的书签。接下来我将给你一些上下文信息，然后你需要回答用户的问题。你可以使用以下文档中的任何信息来回答问题。如果你不确定，或者上下文中没有明确写出答案，你可以说"对不起，我不知道怎么回答这个问题。"`}

    Context sections:
    ${contextText}

    Question: """
    ${question}
    """

    Answer as markdown (including related code snippets if available):
  `

    // In production we should handle possible errors
    const completionResponse = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages:[
            {
                "role": "system", 
                "content": prompt
            }
        ]
    }, {
        proxy: false,
        httpAgent: proxyAgent,
        httpsAgent: proxyAgent
    })

    return completionResponse;
}

askGPT("书签").then((data) => {
    console.log(data)
})