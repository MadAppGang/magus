/**
 * JSON-RPC Request Handler
 * Routes requests to appropriate method handlers
 */

import {
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcSuccessResponse,
  JsonRpcErrorResponse,
  JSON_RPC_ERRORS,
  RpcMethodHandler,
} from './types.js';
import { pluginMethods } from './methods/plugin-methods.js';
import { settingsMethods } from './methods/settings-methods.js';

/**
 * Map of all RPC method handlers
 */
const METHOD_MAP: Record<string, RpcMethodHandler> = {
  ...pluginMethods,
  ...settingsMethods,
};

/**
 * Handle a JSON-RPC request and return a response
 */
export async function handleRpcRequest(request: any): Promise<JsonRpcResponse> {
  const { jsonrpc, method, params, id } = request;

  // Validate JSON-RPC version
  if (jsonrpc !== '2.0') {
    return createErrorResponse(
      JSON_RPC_ERRORS.INVALID_REQUEST,
      'Invalid Request: jsonrpc must be "2.0"',
      id ?? null
    );
  }

  // Validate method field
  if (typeof method !== 'string') {
    return createErrorResponse(
      JSON_RPC_ERRORS.INVALID_REQUEST,
      'Invalid Request: method must be a string',
      id ?? null
    );
  }

  // Validate id field
  if (id === undefined) {
    return createErrorResponse(
      JSON_RPC_ERRORS.INVALID_REQUEST,
      'Invalid Request: id is required',
      null
    );
  }

  // Find method handler
  const handler = METHOD_MAP[method];
  if (!handler) {
    return createErrorResponse(
      JSON_RPC_ERRORS.METHOD_NOT_FOUND,
      `Method not found: ${method}`,
      id
    );
  }

  try {
    // Execute handler
    const result = await handler(params);
    return createSuccessResponse(result, id);
  } catch (error: any) {
    // Handle application errors
    return createErrorResponse(
      error.code ?? JSON_RPC_ERRORS.INTERNAL_ERROR,
      error.message || 'Internal error',
      id,
      {
        error: String(error),
        stack: error.stack,
      }
    );
  }
}

/**
 * Create a success response
 */
function createSuccessResponse(result: any, id: number | string): JsonRpcSuccessResponse {
  return {
    jsonrpc: '2.0',
    result,
    id,
  };
}

/**
 * Create an error response
 */
function createErrorResponse(
  code: number,
  message: string,
  id: number | string | null,
  data?: any
): JsonRpcErrorResponse {
  return {
    jsonrpc: '2.0',
    error: {
      code,
      message,
      ...(data && { data }),
    },
    id,
  };
}
