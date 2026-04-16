require('dotenv').config();

async function main() {
  const { default: OpenAI } = await import('openai');

  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) {
    throw new Error('Missing NVIDIA_API_KEY in environment. Add it to .env.');
  }

  const userPrompt = process.argv.slice(2).join(' ').trim() || 'Say hello in one sentence.';

  const openai = new OpenAI({
    apiKey,
    baseURL: 'https://integrate.api.nvidia.com/v1',
  });

  const completion = await openai.chat.completions.create({
    model: 'openai/gpt-oss-120b',
    messages: [{ role: 'user', content: userPrompt }],
    temperature: 1,
    top_p: 1,
    max_tokens: 4096,
    stream: true,
  });

  for await (const chunk of completion) {
    const delta = chunk.choices?.[0]?.delta;
    const reasoning = delta?.reasoning_content;
    if (reasoning) process.stdout.write(reasoning);
    process.stdout.write(delta?.content || '');
  }
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exitCode = 1;
});

