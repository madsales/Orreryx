export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json({
    hasKey: !!process.env.ANTHROPIC_API_KEY,
    keyPreview: process.env.ANTHROPIC_API_KEY
      ? process.env.ANTHROPIC_API_KEY.slice(0, 15) + '...'
      : 'NOT SET',
    nodeEnv: process.env.NODE_ENV || 'unknown',
    allEnvKeys: Object.keys(process.env).filter(k => !k.includes('PATH') && !k.includes('npm')),
  });
}
