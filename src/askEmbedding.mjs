
import { createClient } from '@supabase/supabase-js'
import { OpenAI } from 'openai'
import { HttpsProxyAgent } from 'https-proxy-agent';

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
    const { data: documents } = await supabase.rpc('match_chunks', {
        //@ts-ignore
        query_embedding: embedding,
        match_threshold: 0.78, // Choose an appropriate threshold for your data
        match_count: 10, // Choose the number of matches
    })

    return documents
}


askEmbedding("如何用ChatGPT做知识管理？").then((data) => {
    console.log(data)
})