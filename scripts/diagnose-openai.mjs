#!/usr/bin/env node
/**
 * Standalone OpenAI diagnostic — proves whether the configured model actually
 * answers on your key via the Responses API, with the exact params the app
 * uses (reasoning effort + structured outputs). No app / DB / auth needed.
 *
 * Usage:
 *   OPENAI_API_KEY=sk-... node scripts/diagnose-openai.mjs
 *   OPENAI_API_KEY=sk-... OPENAI_MODEL=gpt-4o-mini node scripts/diagnose-openai.mjs
 */
import OpenAI from "openai";

const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_MODEL?.trim() || "gpt-5.4-mini";

if (!apiKey) {
  console.error("❌ OPENAI_API_KEY is not set. Run:");
  console.error("   OPENAI_API_KEY=sk-... node scripts/diagnose-openai.mjs");
  process.exit(1);
}

const client = new OpenAI({ apiKey, timeout: 45_000, maxRetries: 0 });

console.log(`\n🔎 Testing model "${model}" via the Responses API...\n`);

const started = Date.now();
try {
  const res = await client.responses.create(
    {
      model,
      instructions: "You are a precise assistant. Reply with strict JSON only.",
      input: "Return a JSON object: {\"ok\": true, \"model_echo\": \"<the model name you are>\"}",
      reasoning: { effort: "low" },
      max_output_tokens: 2000,
      text: {
        format: {
          type: "json_schema",
          name: "diag",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["ok", "model_echo"],
            properties: {
              ok: { type: "boolean" },
              model_echo: { type: "string" },
            },
          },
        },
      },
    },
    { timeout: 45_000 },
  );

  const ms = Date.now() - started;
  const text = res.output_text ?? "";
  console.log(`✅ Call returned in ${ms}ms`);
  console.log(`   status:      ${res.status ?? "n/a"}`);
  console.log(`   output_text: ${text || "(empty)"}`);
  console.log(`   tokens:      ${JSON.stringify(res.usage ?? {})}`);

  if (!text) {
    console.log(
      "\n⚠️  Empty output. The model likely spent the whole token budget on" +
        " reasoning (status 'incomplete'), or the model id is not a" +
        " Responses-API reasoning model. Raise max_output_tokens or switch" +
        " OPENAI_MODEL.",
    );
    process.exit(2);
  }
  console.log("\n🎉 Model works. The app should generate insights fine.\n");
  process.exit(0);
} catch (err) {
  const ms = Date.now() - started;
  console.error(`❌ Call FAILED after ${ms}ms`);
  console.error(`   name:    ${err?.name}`);
  console.error(`   status:  ${err?.status ?? "n/a"}`);
  console.error(`   message: ${err?.message}`);
  if (err?.status === 404 || /model/i.test(err?.message ?? "")) {
    console.error(
      `\n👉 "${model}" is not accessible on this key. Either the id is wrong,` +
        " your account lacks access, or it needs the Chat Completions API" +
        " instead. Set OPENAI_MODEL to a model you can list at" +
        " https://platform.openai.com/settings/organization/limits",
    );
  }
  process.exit(1);
}
