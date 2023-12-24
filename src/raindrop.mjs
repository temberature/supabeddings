import fetch from 'node-fetch';
import { HttpsProxyAgent } from 'https-proxy-agent';
import dotenv from 'dotenv';
dotenv.config();

const accessToken = process.env.accessToken; // Replace with your Raindrop.io API token
const collectionId = 40215604; // 0 represents all bookmarks
const proxyUrl = 'http://127.0.0.1:8118'; // Proxy server address

async function fetchRaindropBookmarks() {
  const url = `https://api.raindrop.io/rest/v1/raindrops/${collectionId}?perpage=50`;
  const proxyAgent = new HttpsProxyAgent(proxyUrl);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${accessToken}` },
      agent: proxyAgent
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data.items; // Return the list of bookmarks
  } catch (error) {
    console.error('Error fetching bookmarks:', error.message);
  }
}

fetchRaindropBookmarks().then(bookmarks => {
  console.log(bookmarks); // Output bookmarks
});
