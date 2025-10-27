import 'dotenv/config';
import https from 'https';

const API_KEY = process.env.GEMINI_API_KEY;
const options = {
  hostname: 'generativelanguage.googleapis.com',
  path: `/v1/models?key=${API_KEY}`,
  method: 'GET'
};

const req = https.request(options, (res) => {
  let data = '';
  res.on('data', chunk => (data += chunk));
  res.on('end', () => {
    try {
      const parsed = JSON.parse(data);
      console.log("✅ Available Models:");
      parsed.models.forEach(m => {
        console.log(`- ${m.name} | ${m.supportedGenerationMethods}`);
      });
    } catch (err) {
      console.error("❌ Failed to parse model list:", err);
      console.log("Raw:", data);
    }
  });
});

req.on('error', (err) => {
  console.error("❌ Request error:", err);
});

req.end();