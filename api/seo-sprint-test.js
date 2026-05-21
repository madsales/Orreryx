export default async function handler(req, res) {
  return res.status(200).json({ ok: true, msg: 'seo-sprint-test alive', ts: Date.now() });
}
