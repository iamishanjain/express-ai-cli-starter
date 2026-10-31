import { confirm, input, password, select } from "@inquirer/prompts";
import { ExpressForgeError } from "../../shared/errors.js";

export interface SelectChoice<T> {
  name: string;
  value: T;
  description?: string;
}

/** Interactive input. Swappable so flows can be tested without a terminal. */
export interface Prompter {
  input(options: { message: string; default?: string; validate?: (value: string) => true | string }): Promise<string>;
  /** Masked entry: nothing is echoed back to the terminal. */
  password(options: { message: string; validate?: (value: string) => true | string }): Promise<string>;
  confirm(options: { message: string; default?: boolean }): Promise<boolean>;
  select<T>(options: { message: string; choices: SelectChoice<T>[]; default?: T }): Promise<T>;
}

export class InquirerPrompter implements Prompter {
  input(options: Parameters<Prompter["input"]>[0]): Promise<string> {
    return guard(() => input(options));
  }

  password(options: Parameters<Prompter["password"]>[0]): Promise<string> {
    return guard(() => password({ ...options, mask: "*" }));
  }

  confirm(options: Parameters<Prompter["confirm"]>[0]): Promise<boolean> {
    return guard(() => confirm(options));
  }

  select<T>(options: Parameters<Prompter["select"]>[0] & { choices: SelectChoice<T>[]; default?: T }): Promise<T> {
    return guard(() => select<T>(options as Parameters<typeof select<T>>[0]));
  }
}

/** Ctrl+C inside a prompt is a cancellation, not a crash. */
async function guard<T>(prompt: () => Promise<T>): Promise<T> {
  try {
    return await prompt();
  } catch (error) {
    if (error instanceof Error && error.name === "ExitPromptError") {
      throw new ExpressForgeError("CANCELLED", "Cancelled.");
    }
    throw error;
  }
}
