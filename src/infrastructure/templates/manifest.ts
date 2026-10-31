import { z } from "zod";

export const SUPPORTED_MANIFEST_VERSION = 1;
export const BASE_CATEGORY = "base";

const slug = z.string().regex(/^[a-z][a-z0-9-]*$/, "Use lowercase letters, digits and hyphens.");
const stringMap = z.record(z.string(), z.string()).default({});

export const TemplateManifestSchema = z
  .object({
    manifestVersion: z.literal(SUPPORTED_MANIFEST_VERSION),
    /** "base" or "<category>/<option>", matching the folder path under templates/. */
    id: z.string().regex(/^[a-z][a-z0-9-]*(\/[a-z][a-z0-9-]*)?$/),
    version: z.string().regex(/^\d+\.\d+\.\d+$/, "Use a semantic version such as 1.0.0."),
    category: slug,
    /** The value users pick for this category, for example "typescript". */
    option: slug.optional(),
    label: z.string().min(1).optional(),
    description: z.string().optional(),
    order: z.number().default(100),
    default: z.boolean().default(false),
    /** Fields merged into the generated package.json (name, version, private, type, ...). */
    package: z.record(z.string(), z.union([z.string(), z.boolean()])).default({}),
    dependencies: stringMap,
    devDependencies: stringMap,
    scripts: stringMap,
    /** Lines appended to the generated .env.example. */
    env: z.array(z.string().regex(/^[A-Z_][A-Z0-9_]*=.*$/, "Use KEY=value lines.")).default([]),
    /** Extra template variables, for example { "ext": "ts" }. */
    variables: z.record(z.string(), z.string()).default({}),
    files: z
      .array(z.object({ from: z.string().min(1), to: z.string().min(1) }))
      .default([])
  })
  .superRefine((manifest, context) => {
    if (manifest.category === BASE_CATEGORY) {
      if (manifest.id !== BASE_CATEGORY) {
        context.addIssue({ code: "custom", message: 'The base template must have id "base".' });
      }
      return;
    }
    if (!manifest.option || !manifest.label) {
      context.addIssue({ code: "custom", message: "Non-base templates need both `option` and `label`." });
    }
    if (manifest.id !== `${manifest.category}/${manifest.option}`) {
      context.addIssue({ code: "custom", message: "`id` must be `<category>/<option>`." });
    }
  });

export type TemplateManifest = z.output<typeof TemplateManifestSchema>;

export interface LoadedTemplate {
  readonly manifest: TemplateManifest;
  /** Absolute path of the folder holding template.json. */
  readonly directory: string;
}
