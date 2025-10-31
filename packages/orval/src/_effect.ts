import {
  asyncReduce,
  type ContextSpecs,
  type GeneratorApiOperations,
  type GeneratorSchema,
  GetterPropType,
  generateVerbsOptions,
  getFullRoute,
  getRoute,
  type ImportOpenApi,
  isReference,
  isString,
  isUrl,
  type NormalizedInputOptions,
  type NormalizedOutputOptions,
  type OptionsExport,
  resolveRef,
} from '@orval/core';
import { type PathItemObject } from 'openapi3-ts/oas30';
import { generateOperations } from './client';
import { generateInputSpecs } from './import-open-api';
import { resolveSpecs } from './import-specs';
import { normalizeOptions } from './utils';

// copy from ./import-specs(importSpecs)，./import-open-api(importOpenApi)
export const _effect_generateContextSpecs = async (
  optionConfig: OptionsExport,
) => {
  const workspace = process.cwd();

  const options = await normalizeOptions(optionConfig);

  const { input, output } = options;

  let importOpenApiPayloads: ImportOpenApi | null = null;

  if (!isString(input.target)) {
    importOpenApiPayloads = {
      data: { [workspace]: input.target },
      input,
      output,
      target: workspace,
      workspace,
    };
  } else {
    const isPathUrl = isUrl(input.target);

    const data = await resolveSpecs(
      input.target,
      input.parserOptions,
      isPathUrl,
      !output.target,
    );

    importOpenApiPayloads = {
      data,
      input,
      output,
      target: input.target,
      workspace,
    };
  }

  const specs = await generateInputSpecs({
    specs: importOpenApiPayloads.data,
    input: importOpenApiPayloads.input,
    workspace: importOpenApiPayloads.workspace,
  });

  return {
    input: importOpenApiPayloads.input,
    output: importOpenApiPayloads.output,
    target: importOpenApiPayloads.target,
    workspace: importOpenApiPayloads.workspace,
    specs,
  };
};

// copy from ./api(getApiBuilder)
export const _effect_getApiGenerate = async ({
  input,
  output,
  context,
}: {
  input: NormalizedInputOptions;
  output: NormalizedOutputOptions;
  context: ContextSpecs;
}) => {
  const api = await asyncReduce(
    Object.entries(context.specs[context.specKey].paths ?? {}),
    async (acc, [pathRoute, verbs]: [string, PathItemObject]) => {
      const route = getRoute(pathRoute);

      let resolvedVerbs = verbs;
      let resolvedContext = context;

      if (isReference(verbs)) {
        const { schema, imports } = resolveRef<PathItemObject>(verbs, context);

        resolvedVerbs = schema;

        resolvedContext = {
          ...context,
          ...(imports.length > 0
            ? {
                specKey: imports[0].specKey,
              }
            : {}),
        };
      }

      let verbsOptions = await generateVerbsOptions({
        verbs: resolvedVerbs,
        input,
        output,
        route,
        pathRoute,
        context: resolvedContext,
      });

      // GitHub #564 check if we want to exclude deprecated operations
      if (output.override.useDeprecatedOperations === false) {
        verbsOptions = verbsOptions.filter((verb) => {
          return !verb.deprecated;
        });
      }

      const schemas = verbsOptions.reduce<GeneratorSchema[]>(
        (acc, { queryParams, headers, body, response, props }) => {
          if (props) {
            acc.push(
              ...props.flatMap((param) =>
                param.type === GetterPropType.NAMED_PATH_PARAMS
                  ? param.schema
                  : [],
              ),
            );
          }
          if (queryParams) {
            acc.push(queryParams.schema, ...queryParams.deps);
          }
          if (headers) {
            acc.push(headers.schema, ...headers.deps);
          }

          acc.push(...body.schemas, ...response.schemas);

          return acc;
        },
        [],
      );

      const fullRoute = getFullRoute(
        route,
        verbs.servers ?? context.specs[context.specKey].servers,
        output.baseUrl,
      );
      if (!output.target) {
        throw new Error('Output does not have a target');
      }
      const pathOperations = await generateOperations(
        output.client,
        verbsOptions,
        {
          route: fullRoute,
          pathRoute,
          override: output.override,
          context: resolvedContext,
          mock: output.mock,
          output: output.target,
        },
        output,
      );

      for (const verbOption of verbsOptions) {
        acc.verbOptions[verbOption.operationId] = verbOption;
      }
      acc.schemas.push(...schemas);
      acc.operations = { ...acc.operations, ...pathOperations };

      return acc;
    },
    {
      operations: {},
      verbOptions: {},
      schemas: [],
    } as GeneratorApiOperations,
  );
  return api;
};

export { getAllSchemas as _effect_getAllSchemas } from './import-open-api';
