import {
  asyncReduce,
  generateVerbsOptions,
  getFullRoute,
  getRoute,
  GetterPropType,
  isReference,
  resolveRef,
  type ContextSpec,
  type GeneratorApiOperations,
  type GeneratorSchema,
  type NormalizedInputOptions,
  type NormalizedOutputOptions,
  type OpenApiPathItemObject,
} from '@orval/core';
import { applyTransformer, getApiSchemas } from './import-open-api';
import { normalizeOptions } from './utils';
import { generateOperations } from './client';

// copy from ./api(getApiBuilder)
const _effect_getApiBuilder = async function ({
  input,
  output,
  context,
}: {
  input: NormalizedInputOptions;
  output: NormalizedOutputOptions;
  context: ContextSpec;
}) {
  const api = await asyncReduce(
    Object.entries(context.spec.paths ?? {}),
    async (acc, [pathRoute, verbs]) => {
      const route = getRoute(pathRoute);

      let resolvedVerbs = verbs;

      if (isReference(verbs)) {
        const { schema } = resolveRef<OpenApiPathItemObject>(verbs, context);

        resolvedVerbs = schema;
      }

      let verbsOptions = await generateVerbsOptions({
        verbs: resolvedVerbs,
        input,
        output,
        route,
        pathRoute,
        context,
      });

      // GitHub #564 check if we want to exclude deprecated operations
      if (output.override.useDeprecatedOperations === false) {
        verbsOptions = verbsOptions.filter((verb) => {
          return !verb.deprecated;
        });
      }

      const schemas: GeneratorSchema[] = [];
      for (const {
        queryParams,
        headers,
        body,
        response,
        props,
      } of verbsOptions) {
        schemas.push(
          ...props.flatMap((param) =>
            param.type === GetterPropType.NAMED_PATH_PARAMS ? param.schema : [],
          ),
        );
        if (queryParams) {
          schemas.push(queryParams.schema, ...queryParams.deps);
        }
        if (headers) {
          schemas.push(headers.schema, ...headers.deps);
        }

        schemas.push(...body.schemas, ...response.schemas);
      }

      const fullRoute = getFullRoute(
        route,
        verbs.servers ?? context.spec.servers,
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
          context,
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

export {
  applyTransformer,
  getApiSchemas,
  normalizeOptions,
  _effect_getApiBuilder,
};
