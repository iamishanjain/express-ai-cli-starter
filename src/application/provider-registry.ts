import type { ProviderDefinition } from "../domain/ai-provider.js";
import { ExpressForgeError } from "../shared/errors.js";

/** Holds every provider the application knows about. Adding a provider is one `register` call. */
export class ProviderRegistry {
  private readonly definitions = new Map<string, ProviderDefinition>();

  register(definition: ProviderDefinition): this {
    const { id } = definition.metadata;
    if (this.definitions.has(id)) {
      throw new ExpressForgeError("INTERNAL", `Provider "${id}" is registered twice.`);
    }
    this.definitions.set(id, definition);
    return this;
  }

  has(id: string): boolean {
    return this.definitions.has(id);
  }

  get(id: string): ProviderDefinition {
    const definition = this.definitions.get(id);
    if (!definition) {
      throw new ExpressForgeError("UNSUPPORTED_PROVIDER", `Unknown AI provider "${id}".`, {
        hint: `Available providers: ${this.ids().join(", ") || "(none)"}. Run \`expressforge providers list\`.`
      });
    }
    return definition;
  }

  list(): ProviderDefinition[] {
    return [...this.definitions.values()];
  }

  ids(): string[] {
    return [...this.definitions.keys()];
  }
}
