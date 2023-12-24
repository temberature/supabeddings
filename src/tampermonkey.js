// ==UserScript==
// @name         Enhanced Google Search with Sidebar Results from Supabase
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  Extend your Google search experience by displaying additional search results in a sidebar, powered by Supabase and OpenAI. Users can customize Supabase URL and Key for personalized search enhancements.
// @author       Your Name
// @match        https://www.google.com/search?*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @license      MIT
// ==/UserScript==


(function () {
    'use strict';

    // Add custom styles for the sidebar
    GM_addStyle(`
        #custom-search-sidebar {
            position: fixed;
            right: 0;
            top: 0;
            width: 30%;
            height: 100%;
            background-color: white;
            overflow-y: auto;
            border-left: 1px solid #ccc;
            z-index: 9999;
            padding: 10px;
            box-sizing: border-box;
        }
    `);

    // Function to get or request the Supabase URL
    function getSupabaseUrl() {
        let supabaseUrl = GM_getValue('supabaseUrl');
        if (!supabaseUrl) {
            supabaseUrl = prompt('请输入您的 Supabase URL:');
            GM_setValue('supabaseUrl', supabaseUrl);
        }
        return supabaseUrl;
    }

    const supabaseUrl = getSupabaseUrl();

    // Function to get or request the Supabase Key
    function getSupabaseKey() {
        let supabaseKey = GM_getValue('supabaseKey');
        if (!supabaseKey) {
            supabaseKey = prompt('请输入您的 Supabase Key:');
            GM_setValue('supabaseKey', supabaseKey);
        }
        return supabaseKey;
    }

    const supabaseKey = getSupabaseKey();

    // Function to get or request the OpenAI Key
    function getOpenAIKey() {
        let openAIKey = GM_getValue('openAIKey');
        if (!openAIKey) {
            openAIKey = prompt('请输入您的 OpenAI Key:');
            GM_setValue('openAIKey', openAIKey);
        }
        return openAIKey;
    }

    const openAIKey = getOpenAIKey();

    // Function to fetch embeddings from OpenAI
    async function fetchEmbedding(question) {
        const response = await fetch('https://api.openai.com/v1/embeddings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${openAIKey}`
            },
            body: JSON.stringify({
                model: "text-embedding-ada-002",
                input: question
            })
        });
        const data = await response.json();
        return data.data[0].embedding;
    }

    // Function to query Supabase with embeddings
    async function querySupabase(embedding) {
        const response = await fetch(`${supabaseUrl}/rest/v1/rpc/match_chunks`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': supabaseKey
            },
            body: JSON.stringify({ query_embedding: embedding, match_count: 10, match_threshold: 0.78 })
        });
        return response.json();
    }

    // Create the sidebar div
    const sidebar = document.createElement('div');
    sidebar.id = 'custom-search-sidebar';
    document.body.appendChild(sidebar);

    // Extract the search query from the URL
    const params = new URLSearchParams(window.location.search);
    const query = params.get('q');

    // Function to display results in the sidebar
    function displayResults(results) {
        sidebar.innerHTML = ''; // Clear existing content in the sidebar

        if (results && results.length > 0) {
            const list = document.createElement('ul');
            list.style.listStyle = 'none';
            list.style.padding = '0';
            list.style.margin = '0';

            results.forEach(item => {
                const listItem = document.createElement('li');
                listItem.style.marginBottom = '10px';

                // Title
                if (item.title) {
                    const title = document.createElement('div');
                    title.textContent = item.title;
                    title.style.fontWeight = 'bold';
                    listItem.appendChild(title);
                }

                // URL
                if (item.url) {
                    const url = document.createElement('a');
                    url.href = item.url;
                    url.textContent = item.url;
                    url.style.display = 'block';
                    url.style.marginBottom = '5px';
                    url.style.color = '#1a0dab';
                    url.target = '_blank';
                    listItem.appendChild(url);
                }

                // Excerpt
                if (item.excerpt) {
                    const excerpt = document.createElement('div');
                    excerpt.textContent = item.excerpt;
                    listItem.appendChild(excerpt);
                }

                // Content
                const content = document.createElement('div');
                content.textContent = item.content;
                listItem.appendChild(content);

                // Similarity Score
                const similarity = document.createElement('div');
                similarity.textContent = `Similarity Score: ${item.similarity}`;
                similarity.style.fontSize = 'small';
                similarity.style.color = 'gray';
                listItem.appendChild(similarity);

                list.appendChild(listItem);
            });

            sidebar.appendChild(list);
        } else {
            sidebar.textContent = 'No results found.';
        }
    }



    // Execute the search and display in sidebar
    fetchEmbedding(query).then(embedding => {
        querySupabase(embedding).then(results => {
            console.log(results);
            displayResults(results);
        });
    });
})();
