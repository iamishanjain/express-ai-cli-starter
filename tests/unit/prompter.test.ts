import { describe, expect, it, vi } from "vitest";

const prompts = vi.hoisted(() => ({
  input: vi.fn(),
  confirm: vi.fn(),
  select: vi.fn(),
  password: vi.fn()
}));
vi.mock("@inquirer/prompts", () => prompts);

import { InquirerPrompter } from "../../src/presentation/prompts/prompter.js";

const exitPrompt = () => Object.assign(new Error("User force closed the prompt"), { name: "ExitPromptError" });

describe("InquirerPrompter", () => {
  it("masks password input", async () => {
    prompts.password.mockResolvedValue("secret");
    await new InquirerPrompter().password({ message: "Key:" });
    expect(prompts.password).toHaveBeenCalledWith(expect.objectContaining({ message: "Key:", mask: "*" }));
  });

  it.each([
    ["input", (p: InquirerPrompter) => p.input({ message: "x" }), prompts.input],
    ["password", (p: InquirerPrompter) => p.password({ message: "x" }), prompts.password],
    ["confirm", (p: InquirerPrompter) => p.confirm({ message: "x" }), prompts.confirm],
    ["select", (p: InquirerPrompter) => p.select({ message: "x", choices: [{ name: "a", value: 1 }] }), prompts.select]
  ])("maps Ctrl+C in %s to CANCELLED", async (_name, call, mock) => {
    mock.mockRejectedValue(exitPrompt());
    await expect(call(new InquirerPrompter())).rejects.toMatchObject({ code: "CANCELLED" });
  });

  it("lets other errors through unchanged", async () => {
    const failure = new Error("boom");
    prompts.input.mockRejectedValue(failure);
    await expect(new InquirerPrompter().input({ message: "x" })).rejects.toBe(failure);
  });
});
