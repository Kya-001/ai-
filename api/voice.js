// Vercel Serverless Function: POST /api/voice
// Gemini free-tier model only. Do not add billing or paid-model fallback.
const MODEL = "gemini-3.8-flash";
const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 8;
const MAX_BODY_CHARS = 30000;
const hits = new Map();

function rateLimited(ip) {
  const now = Date.now();
  const record = hits.get(ip);
  if (!record || now - record.start >= WINDOW_MS) {
    hits.set(ip, { start: now, count: 1 });
    return false;
  }
  record.count += 1;
  return record.count > MAX_REQUESTS_PER_WINDOW;
}

function text(value, max = 12000) {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function makeSchema(action) {
  if (action === "analyze") {
    return {
      type: "OBJECT",
      properties: {
        scores: {
          type: "OBJECT",
          properties: {
            naturalness: { type: "INTEGER" },
            characterConsistency: { type: "INTEGER" },
            conciseness: { type: "INTEGER" },
            voiceFriendliness: { type: "INTEGER" }
          },
          required: ["naturalness", "characterConsistency", "conciseness", "voiceFriendliness"]
        },
        issues: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              title: { type: "STRING" },
              original: { type: "STRING" },
              reason: { type: "STRING" },
              suggestion: { type: "STRING" }
            },
            required: ["title", "original", "reason", "suggestion"]
          }
        },
        summary: { type: "STRING" }
      },
      required: ["scores", "issues", "summary"]
    };
  }
  return {
    type: "OBJECT",
    properties: {
      rewrite: { type: "STRING" },
      notes: { type: "STRING" }
    },
    required: ["rewrite", "notes"]
  };
}

function makePrompt(body) {
  const character = body.character && typeof body.character === "object"
    ? body.character : {};
  const characterText = JSON.stringify({
    name: text(character.name, 100),
    traits: text(character.traits, 1200),
    habits: text(character.habits, 2000),
    examples: text(character.examples, 2000),
    avoid: text(character.avoid, 1200)
  });
  const dialogue = text(body.dialogue, 12000);
  const scene = text(body.scene, 2000);

  if (body.action === "analyze") {
    return {
      system: "你是专业的影视对白编剧、表演指导和台词质检专家。必须尊重用户给出的角色设定，不得擅自添加性格。评分是辅助判断，不得为了显得严格而虚构问题。问题必须引用输入中的真实原文；如果没有明显问题，issues 可以为空数组。所有输出使用简体中文。严格按 JSON Schema 返回。",
      prompt: `请分析以下对白。
角色设定：${characterText}
场景上下文：${scene || "未提供"}
待分析对白：
${dialogue}

从四个维度分别给出 0-100 分：
1. naturalness：口语自然度
2. characterConsistency：角色一致性；无角色设定时请降低此项判断置信度，不要假装了解角色
3. conciseness：表达简洁度
4. voiceFriendliness：配音友好度，包括断句、气口、节奏和可念性

issues 给出最多 6 个最有价值的问题。每项包含 title、original（原文短片段）、reason、suggestion。不要把建议改写成强制结论。summary 用 1-3 句话总结。`
    };
  }

  const modes = {
    natural: "自然口语版：更自然、有生活感，保留情绪与交流细节，更适合小说。不要过度删减信息。",
    concise: "精炼表达版：删去冗余，突出信息与节奏，短句优先，更适合 AI 短剧。保留剧情事实和必要情绪。",
    character: "情绪与人物表现强化版：结合角色性格、语言习惯、场景情绪与人物关系调整表达，更突出人物塑造。不得把角色擅自改成霸气、毒舌或其他未设定的人格。"
  };
  return {
    system: "你是资深影视编剧和对白润色专家。必须忠于原文剧情事实、人物关系和用户提供的角色声纹。不要添加新剧情、设定或信息。只输出符合 JSON Schema 的结果，使用简体中文。",
    prompt: `改写方向：${modes[body.mode] || modes.natural}
角色设定：${characterText}
场景上下文：${scene || "未提供"}
原始对白：
${dialogue}

请只返回一版完整改写，不要解释过程。notes 简要说明改写重点。`
  };
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "仅支持 POST 请求" });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: "服务端尚未配置 GEMINI_API_KEY，请在部署平台添加环境变量。" });
  }

  const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown")
    .toString().split(",")[0].trim();
  if (rateLimited(ip)) {
    return res.status(429).json({ error: "请求太频繁，请等待一分钟后再试。" });
  }

  const body = req.body || {};
  if (JSON.stringify(body).length > MAX_BODY_CHARS) {
    return res.status(413).json({ error: "输入内容过长，请缩短对白后重试。" });
  }
  if (!["analyze", "rewrite"].includes(body.action)) {
    return res.status(400).json({ error: "未知操作类型。" });
  }
  if (!text(body.dialogue, 12000).trim()) {
    return res.status(400).json({ error: "请先输入对白。" });
  }

  const built = makePrompt(body);
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

  try {
    const upstream = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: built.system }] },
        contents: [{ role: "user", parts: [{ text: built.prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: makeSchema(body.action),
          temperature: body.action === "analyze" ? 0.35 : 0.75,
          maxOutputTokens: body.action === "analyze" ? 1800 : 1400
        }
      })
    });

    const payload = await upstream.json();
    if (!upstream.ok) {
      const status = upstream.status === 429 ? 429 : 502;
      const message = upstream.status === 429
        ? "Gemini 免费额度或请求频率暂时达到上限，请稍后再试。"
        : upstream.status === 400
          ? "Gemini 请求参数或模型配置有误，请检查 API Key 所属项目和模型可用性。"
          : "Gemini 服务暂时不可用，请稍后重试。";
      console.error("Gemini upstream error:", upstream.status, payload?.error?.message || "unknown");
      return res.status(status).json({ error: message });
    }

    const raw = payload?.candidates?.[0]?.content?.parts
      ?.map(part => part.text || "").join("").trim();
    if (!raw) return res.status(502).json({ error: "Gemini 没有返回可用内容，请重试。" });

    let result;
    try {
      result = JSON.parse(raw);
    } catch {
      console.error("Gemini returned invalid JSON");
      return res.status(502).json({ error: "AI 返回格式异常，请重试。" });
    }
    return res.status(200).json({ result });
  } catch (error) {
    console.error("VoiceDNA API error:", error?.message || error);
    return res.status(500).json({ error: "服务暂时无法连接 Gemini，请检查部署状态后重试。" });
  }
};
