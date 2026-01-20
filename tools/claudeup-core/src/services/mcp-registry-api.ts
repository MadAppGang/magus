/**
 * MCP Registry API Client
 * Searches the official Model Context Protocol Registry
 * API Docs: https://registry.modelcontextprotocol.io
 */

const MCP_REGISTRY_API = "https://registry.modelcontextprotocol.io/v0";

export interface McpEnvironmentVariable {
  name: string;
  description?: string;
  isSecret?: boolean;
  format?: string;
}

export interface McpRegistryServer {
  name: string;
  url: string;
  short_description: string;
  version?: string;
  source_code_url?: string;
  package_registry?: string;
  published_at?: string;
  updated_at?: string;
  transport_type?: string;
  environment_variables?: McpEnvironmentVariable[];
  is_latest?: boolean;
  // Additional fields
  remote_url?: string; // For HTTP-based servers
  package_identifier?: string; // npm package name
  repository_source?: string; // e.g., "github"
}

export interface McpRegistryResponse {
  servers: McpRegistryServer[];
  next_cursor?: string;
}

export interface SearchOptions {
  query?: string;
  limit?: number;
  cursor?: string;
}

export async function searchMcpRegistry(
  options: SearchOptions = {}
): Promise<McpRegistryResponse> {
  const { query = "", limit = 20, cursor } = options;

  const params = new URLSearchParams();
  if (query) params.set("query", query);
  params.set("limit", String(limit));
  if (cursor) params.set("cursor", cursor);

  const url = `${MCP_REGISTRY_API}/servers?${params.toString()}`;

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(
      `MCP Registry API error: ${response.status} ${response.statusText}`
    );
  }

  const data: any = await response.json();

  // The official registry returns data in a nested format:
  // { servers: [{ server: {...}, _meta: {...} }] }
  // Convert it to match our expected McpRegistryResponse format
  const servers: McpRegistryServer[] = (data.servers || [])
    .map((item: any) => {
      const server = item.server || item; // Handle both nested and flat structures
      const meta = item._meta?.["io.modelcontextprotocol.registry/official"];

      // Get URL from remotes (HTTP) or construct from packages
      let serverUrl = "";
      if (server.remotes?.length > 0) {
        serverUrl = server.remotes[0].url;
      } else if (server.packages?.length > 0) {
        // For package-based servers, use the package identifier as reference
        const pkg = server.packages[0];
        serverUrl = `${pkg.registryType}:${pkg.identifier}`;
      }

      // Extract environment variables from packages
      const envVars: McpEnvironmentVariable[] = [];
      if (server.packages?.[0]?.environmentVariables) {
        for (const env of server.packages[0].environmentVariables) {
          envVars.push({
            name: env.name,
            description: env.description,
            isSecret: env.isSecret,
            format: env.format,
          });
        }
      }

      // Get transport type from packages OR remotes
      const transportType =
        server.packages?.[0]?.transport?.type ||
        server.remotes?.[0]?.type ||
        undefined;

      // Get remote URL for HTTP-based servers
      const remoteUrl = server.remotes?.[0]?.url;

      // Get package identifier for npm packages
      const packageIdentifier = server.packages?.[0]?.identifier;

      return {
        name: server.name,
        url: serverUrl,
        short_description: server.description || "No description",
        version: server.version,
        source_code_url: server.repository?.url,
        package_registry: server.packages?.[0]?.registryType,
        published_at: meta?.publishedAt,
        updated_at: meta?.updatedAt,
        transport_type: transportType,
        environment_variables: envVars.length > 0 ? envVars : undefined,
        is_latest: meta?.isLatest,
        remote_url: remoteUrl,
        package_identifier: packageIdentifier,
        repository_source: server.repository?.source,
      };
    })
    // Filter out servers without name or URL, and only keep latest versions
    .filter((s: McpRegistryServer) => s.name && s.url && s.is_latest !== false)
    // Deduplicate by name (keep first occurrence which should be latest)
    .filter((s: McpRegistryServer, index: number, arr: McpRegistryServer[]) =>
      arr.findIndex((item) => item.name === s.name) === index
    )
    // Sort by publish date (newest first)
    .sort((a: McpRegistryServer, b: McpRegistryServer) => {
      if (!a.published_at) return 1;
      if (!b.published_at) return -1;
      return (
        new Date(b.published_at).getTime() - new Date(a.published_at).getTime()
      );
    });

  return {
    servers,
    next_cursor: data.metadata?.nextCursor || data.next_cursor,
  };
}

export async function getPopularMcpServers(
  limit = 20
): Promise<McpRegistryServer[]> {
  const response = await searchMcpRegistry({ limit });
  return response.servers;
}

export function formatRelativeDate(dateStr?: string): string {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
  return `${Math.floor(diffDays / 365)}y ago`;
}
