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


async function getEmbeddings(content) {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
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
    const responseJson = await response.json();
    return responseJson.data[0].embedding;
}

function splitContentForEmbedding(content, maxTokens = 8191) {
    const paragraphs = content.split(/\n+/);
    let chunks = [];

    paragraphs.forEach(paragraph => {
        // 如果段落本身就超过了最大token数，则需要进一步分割
        if (gpt3Encoder.encode(paragraph).length > maxTokens) {
            let start = 0;
            while (start < paragraph.length) {
                let end = start;
                while (end < paragraph.length && gpt3Encoder.encode(paragraph.substring(start, end)).length <= maxTokens) {
                    end++;
                }
                // 防止无限循环
                if (end === start) {
                    end++;
                }
                chunks.push(paragraph.substring(start, end));
                start = end;
            }
        } else {
            // 如果段落长度小于最大token数，则直接作为一个chunk
            chunks.push(paragraph);
        }
    });

    return chunks;
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
    if (!await insertBookmarkIfNotExists(bookmark)) {
        return;
    }

    const pageContent = await fetchPageContent(bookmark.link);
    if (!pageContent) {
        console.warn(`No content found for bookmark ${bookmark.id}`);
        return;
    }

    // 将网页内容转换为Markdown
    const markdownContent = turndownService.turndown(pageContent);

    // 这里可以对Markdown内容进行其他处理，例如保存到文件或数据库
    console.log(markdownContent); // 打印Markdown内容，或进行其他处理
    // return;
    // 如果需要继续处理Markdown内容，比如分割和获取Embeddings
    const contentChunks = splitContentForEmbedding(markdownContent);

    for (let i = 0; i < contentChunks.length; i++) {
        const chunkEmbedding = await getEmbeddings(contentChunks[i]);
        await saveChunkToSupabase(bookmark, contentChunks[i], i, chunkEmbedding);
    }
}

// ...main函数和其他代码...


const exampleBookmark = {
    id: "701711251", // 确保这是一个唯一的ID
    title: "用ChatGPT做知识管理",
    link: "https://jojovi.medium.com/%E7%94%A8chatgpt%E5%81%9A%E7%9F%A5%E8%AF%86%E7%AE%A1%E7%90%86-5dff55eaee11",
};

processBookmark(exampleBookmark);
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

