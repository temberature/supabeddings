import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import md5 from 'md5';
import dotenv from 'dotenv';
import gpt3Encoder from 'gpt-3-encoder';
import { fetchRaindropBookmarks } from './raindrop.mjs';
import TurndownService from 'turndown';
import { get_encoding, encoding_for_model } from "tiktoken";
import cron from 'node-cron';



const enc = get_encoding("cl100k_base");

// 初始化Turndown服务
const turndownService = new TurndownService();

dotenv.config();
const proxyUrl = 'http://127.0.0.1:8118'; // 代理服务器地址
const proxyAgent = new HttpsProxyAgent(proxyUrl);
const supabaseUrl = process.env.supabaseUrl;
const openAIKey = process.env.openAIKey;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const supabase = createClient(supabaseUrl, SUPABASE_SERVICE_KEY);

async function fetchPageContent(url) {
    try {
        const response = await fetch(url, { agent: proxyAgent });
        const html = await response.text();
        const dom = new JSDOM(html);
        const reader = new Readability(dom.window.document);
        const article = reader.parse();

        return article ? new JSDOM(article.content).serialize() : '';
    } catch (error) {
        console.error('Error fetching page content:', error);
        return '';
    }
}


async function getEmbeddings(chunks) {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${openAIKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            input: chunks, // chunks 是一个文本数组
            model: "text-embedding-ada-002",
        }),
        agent: proxyAgent,
        signal: AbortSignal.timeout(10000),
    });
    const responseJson = await response.json();
    return responseJson.data.map(item => item.embedding); // 返回每个块的嵌入向量数组
}


function splitContentForEmbedding(content, minTokens = 20, maxTokens = 8191) {
    const paragraphs = content.split(/\n+/);
    let chunks = [];
    let tempChunk = '';

    paragraphs.forEach(paragraph => {
        if (!paragraph) {
            console.warn("发现空段落，跳过编码");
            return;
        }
        const paragraphTokens = enc.encode(paragraph).length;

        if (enc.encode(tempChunk + paragraph).length > maxTokens || paragraphTokens > maxTokens) {
            if (tempChunk) {
                chunks.push(tempChunk);
                tempChunk = '';
            }
            let subChunks = splitLargeParagraph(paragraph, maxTokens);
            chunks = chunks.concat(subChunks);
        } else {
            tempChunk += paragraph + '\n\n';
            if (enc.encode(tempChunk).length >= minTokens) {
                chunks.push(tempChunk);
                tempChunk = '';
            }
        }
    });

    if (tempChunk) {
        chunks.push(tempChunk);
    }

    return chunks;
}

function splitLargeParagraph(paragraph, maxTokens) {
    let subChunks = [];
    let start = 0;

    while (start < paragraph.length) {
        let end = start;
        while (end < paragraph.length && enc.encode(paragraph.substring(start, end)).length <= maxTokens) {
            end++;
        }
        if (end === start) {
            end++;
        }
        subChunks.push(paragraph.substring(start, end));
        start = end;
    }

    return subChunks;
}




// ...之前的import语句...

async function saveChunkToSupabase(bookmark, chunk, chunkIndex, chunkEmbedding) {
    const contentMd5 = md5(chunk);

    const chunkData = {
        bookmark_id: bookmark.id, // 假设每个书签有唯一的ID
        title: bookmark.title,
        url: bookmark.link,
        excerpt: bookmark.excerpt ?? "",
        chunk_index: chunkIndex, // 文本片段在原文中的顺序
        checksum: contentMd5,
        content: chunk,
        embedding: chunkEmbedding,
    };

    const { data: newChunk, error: insertError } = await supabase
        .from('document_chunks')
        .insert([chunkData])
        .single();

    if (insertError) {
        console.error('Error saving new chunk:', insertError);
        return;
    }

    if (newChunk) {
        console.log('Saved new chunk:', newChunk.title);
    } else {
        console.log('Chunk saved, but no data returned');
    }
}

async function insertBookmarkIfNotExists(bookmark) {
    try {
        const { data, error: selectError } = await supabase
            .from('documents')
            .select('id')
            .eq('id', bookmark.id);

        if (selectError) {
            console.error('Error querying existing bookmark:', selectError);
            return false;
        }

        if (data.length === 0) {
            const { error: insertError } = await supabase
                .from('documents')
                .insert([{ id: bookmark.id, title: bookmark.title, url: bookmark.link, description: bookmark.excerpt }]);

            if (insertError) {
                console.error('Error inserting new bookmark:', insertError);
                return false;
            }
        }

        return true;
    } catch (error) {
        console.error('Error during database operation:', error);
        return false;
    }
}

// ...之前的import语句和函数定义...

async function processBookmark(bookmark) {
    console.log(bookmark.link);
    // 检查该网址是否已经处理过
    const { data: existingData, error: selectError } = await supabase
        .from('documents')
        .select('url')
        .eq('url', bookmark.link);
    
    if (selectError) {
        console.error('Error querying existing URL:', selectError);
        return;
    }

    // 如果该网址已经存在，则跳过处理
    if (existingData && existingData.length > 0) {
        console.log(`URL already processed: ${bookmark.link}`);
        return;
    }
    // return;

    // 如果网址不存在，则插入新的书签并处理内容
    const inserted = await insertBookmarkIfNotExists(bookmark);
    if (!inserted) {
        return;
    }

    const pageContent = await fetchPageContent(bookmark.link);
    if (!pageContent) {
        console.warn(`No content found for bookmark ${bookmark.id}`);
        return;
    }

    const markdownContent = turndownService.turndown(pageContent);
    const contentChunks = splitContentForEmbedding(markdownContent);
    const chunksEmbeddings = await getEmbeddings(contentChunks);

    if (chunksEmbeddings.length !== contentChunks.length) {
        console.error('Mismatch in number of chunks and embeddings');
        return;
    }

    // 准备要插入的数据数组
    let chunksData = [];
    for (let i = 0; i < contentChunks.length; i++) {
        const contentMd5 = md5(contentChunks[i]);
        chunksData.push({
            bookmark_id: bookmark.id,
            title: bookmark.title,
            url: bookmark.link,
            excerpt: bookmark.excerpt ?? "",
            chunk_index: i,
            checksum: contentMd5,
            content: contentChunks[i],
            embedding: chunksEmbeddings[i],
        });
    }

    // 一次性插入所有块数据
    const { data, error } = await supabase
        .from('document_chunks')
        .insert(chunksData);

    if (error) {
        console.error('Error saving chunks:', error);
    } else {
        console.log('Saved chunks:', data.length);
    }
}


// ...main函数和其他代码...


const exampleBookmark = {
    id: "701711251", // 确保这是一个唯一的ID
    title: "用ChatGPT做知识管理",
    link: "https://jojovi.medium.com/%E7%94%A8chatgpt%E5%81%9A%E7%9F%A5%E8%AF%86%E7%AE%A1%E7%90%86-5dff55eaee11",
};

// processBookmark(exampleBookmark);
// ...之前的所有import语句和函数定义...

async function main() {
    const bookmarks = await fetchRaindropBookmarks();
    if (bookmarks) {
        for (const bookmark of bookmarks) {
            // 假设每个书签有一个唯一的ID和必要的字段
            const processedBookmark = {
                id: bookmark._id,
                title: bookmark.title,
                link: bookmark.link,
                excerpt: bookmark.excerpt
            };
            await processBookmark(processedBookmark);
        }
    }
}

// main();

// 每分钟执行任务
cron.schedule('* * * * *', async () => {
    console.log('Running task every minute');
    await main();
});