import type { CliContext } from "../context.js";

export async function listProviders(ctx: CliContext, flags: { json?: boolean }): Promise<void> {
  const settings = await ctx.settings.resolve();
  const rows = [];
  for (const { metadata } of ctx.registry.list()) {
    const inspection = await ctx.credentials.inspect(metadata.id);
    rows.push({
      id: metadata.id,
      name: metadata.displayName,
      defaultModel: metadata.defaultModel,
      apiKeyEnvVar: metadata.envVar,
      selected: metadata.id === settings.providerId,
      credential: inspection.source
    });
  }

  if (flags.json) {
    ctx.ui.line(JSON.stringify(rows, null, 2));
    return;
  }
  ctx.ui.heading("AI providers");
  for (const row of rows) {
    const marker = row.selected ? "*" : " ";
    ctx.ui.line(` ${marker} ${row.id.padEnd(10)} ${row.name}`);
    ctx.ui.line(`     default model: ${row.defaultModel}   key variable: ${row.apiKeyEnvVar}   key: ${row.credential}`);
  }
  ctx.ui.line("\n* = selected provider");
}
