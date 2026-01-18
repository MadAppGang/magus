import { useState } from "react";
import { usePlugins, useEnablePlugin, useDisablePlugin, useRefreshMarketplaces } from "../hooks/usePlugins";
import { useMarketplaces, useAddMarketplace, useRemoveMarketplace } from "../hooks/useMarketplaces";
import { useProgress } from "../hooks/useProgress";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Progress } from "../components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../components/ui/dialog";

export function PluginsScreen() {
  const [scope, setScope] = useState<"global" | "project">("project");
  const [searchQuery, setSearchQuery] = useState("");
  const [showAddMarketplace, setShowAddMarketplace] = useState(false);
  const [marketplaceUrl, setMarketplaceUrl] = useState("");
  const [marketplaceError, setMarketplaceError] = useState("");

  const { data: plugins, isLoading, error } = usePlugins(scope);
  const { data: marketplaces, isLoading: marketplacesLoading } = useMarketplaces();
  const addMarketplaceMutation = useAddMarketplace();
  const removeMarketplaceMutation = useRemoveMarketplace();
  const enableMutation = useEnablePlugin();
  const disableMutation = useDisablePlugin();
  const refreshMutation = useRefreshMarketplaces();
  const progress = useProgress();

  // Validate Git URL format
  const validateGitUrl = (url: string): boolean => {
    const patterns = [
      /^https:\/\/github\.com\/[\w-]+\/[\w.-]+/,
      /^https:\/\/gitlab\.com\/[\w-]+\/[\w.-]+/,
      /^https:\/\/bitbucket\.org\/[\w-]+\/[\w.-]+/,
      /^git@github\.com:[\w-]+\/[\w.-]+\.git$/,
      /^git@gitlab\.com:[\w-]+\/[\w.-]+\.git$/,
    ];
    return patterns.some(p => p.test(url.trim()));
  };

  const handleAddMarketplace = async () => {
    const cleanUrl = marketplaceUrl.trim();

    if (!validateGitUrl(cleanUrl)) {
      setMarketplaceError("Invalid Git URL. Use https://github.com/owner/repo or git@github.com:owner/repo.git");
      return;
    }

    try {
      await addMarketplaceMutation.mutateAsync({ url: cleanUrl });
      setShowAddMarketplace(false);
      setMarketplaceUrl("");
      setMarketplaceError("");
    } catch (err) {
      setMarketplaceError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleRemoveMarketplace = async (name: string, displayName: string) => {
    if (!window.confirm(`Remove marketplace "${displayName}"? Installed plugins from this marketplace will remain but become orphaned.`)) {
      return;
    }

    try {
      await removeMarketplaceMutation.mutateAsync({ name });
    } catch (err) {
      alert(`Failed to remove marketplace: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const filteredPlugins = plugins?.filter((plugin) =>
    plugin.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    plugin.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleTogglePlugin = (pluginId: string, currentlyEnabled: boolean) => {
    if (currentlyEnabled) {
      disableMutation.mutate({ pluginId, enabled: false, scope });
    } else {
      enableMutation.mutate({ pluginId, enabled: true, scope });
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Plugins</h1>
        <p className="text-muted-foreground">Manage Claude Code plugins for your project</p>
      </div>

      <div className="flex items-center gap-4">
        <Input
          type="search"
          placeholder="Search plugins..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="flex-1"
        />

        <div className="flex gap-2">
          <Button
            variant={scope === "global" ? "default" : "outline"}
            onClick={() => setScope("global")}
          >
            Global
          </Button>
          <Button
            variant={scope === "project" ? "default" : "outline"}
            onClick={() => setScope("project")}
          >
            Project
          </Button>
        </div>

        <Button
          variant="outline"
          onClick={() => refreshMutation.mutate()}
          disabled={refreshMutation.isPending}
        >
          {refreshMutation.isPending ? "Refreshing..." : "Refresh"}
        </Button>
      </div>

      {progress && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{progress.status}</CardTitle>
          </CardHeader>
          <CardContent>
            <Progress value={progress.percent} />
          </CardContent>
        </Card>
      )}

      {/* Marketplaces Section */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <div>
            <CardTitle className="text-lg">Marketplaces</CardTitle>
            <CardDescription>Plugin sources for Claude Code</CardDescription>
          </div>
          <Dialog open={showAddMarketplace} onOpenChange={setShowAddMarketplace}>
            <DialogTrigger asChild>
              <Button size="sm">Add Marketplace</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Custom Marketplace</DialogTitle>
                <DialogDescription>
                  Enter the Git URL of a marketplace repository.
                  Supports GitHub, GitLab, and Bitbucket.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <Input
                  placeholder="https://github.com/owner/repo"
                  value={marketplaceUrl}
                  onChange={(e) => {
                    setMarketplaceUrl(e.target.value);
                    setMarketplaceError("");
                  }}
                  disabled={addMarketplaceMutation.isPending}
                />
                {marketplaceError && (
                  <p className="text-sm text-destructive">{marketplaceError}</p>
                )}
                {addMarketplaceMutation.isPending && (
                  <div className="space-y-2">
                    <Progress value={50} />
                    <p className="text-sm text-muted-foreground">Cloning repository...</p>
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowAddMarketplace(false);
                    setMarketplaceUrl("");
                    setMarketplaceError("");
                  }}
                  disabled={addMarketplaceMutation.isPending}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleAddMarketplace}
                  disabled={addMarketplaceMutation.isPending || !marketplaceUrl.trim()}
                >
                  {addMarketplaceMutation.isPending ? "Adding..." : "Add"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          {marketplacesLoading ? (
            <p className="text-sm text-muted-foreground">Loading marketplaces...</p>
          ) : (
            <div className="space-y-2">
              {marketplaces?.map((marketplace) => (
                <div
                  key={marketplace.id}
                  className="flex items-center justify-between p-3 rounded-lg border bg-muted/20"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-lg">
                      {marketplace.icon === 'shield' ? '🛡️' :
                       marketplace.icon === 'zap' ? '⚡' : '🌐'}
                    </span>
                    <div>
                      <p className="font-medium">{marketplace.name}</p>
                      <p className="text-sm text-muted-foreground">{marketplace.count}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {marketplace.isDefault ? (
                      <Badge variant="secondary">Default</Badge>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        onClick={() => handleRemoveMarketplace(marketplace.id, marketplace.name)}
                        disabled={removeMarketplaceMutation.isPending}
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                </div>
              ))}
              {marketplaces?.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No marketplaces configured
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {isLoading && (
        <div className="text-center py-12">
          <p className="text-muted-foreground">Loading plugins...</p>
        </div>
      )}

      {error && (
        <Card className="border-destructive">
          <CardHeader>
            <CardTitle>Error</CardTitle>
            <CardDescription>{error.message}</CardDescription>
          </CardHeader>
        </Card>
      )}

      {!isLoading && !error && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredPlugins?.length === 0 && (
            <Card className="col-span-full">
              <CardContent className="py-12 text-center">
                <p className="text-muted-foreground">
                  {searchQuery ? "No plugins match your search" : "No plugins installed"}
                </p>
              </CardContent>
            </Card>
          )}

          {filteredPlugins?.map((plugin) => (
            <Card key={plugin.id}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle>{plugin.name}</CardTitle>
                    <CardDescription className="mt-1">{plugin.version}</CardDescription>
                  </div>
                  <Badge variant={plugin.enabled ? "default" : "secondary"}>
                    {plugin.enabled ? "Enabled" : "Disabled"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{plugin.description}</p>
              </CardContent>
              <CardFooter className="gap-2">
                <Button
                  size="sm"
                  variant={plugin.enabled ? "outline" : "default"}
                  onClick={() => handleTogglePlugin(plugin.id, plugin.enabled)}
                  disabled={enableMutation.isPending || disableMutation.isPending}
                >
                  {plugin.enabled ? "Disable" : "Enable"}
                </Button>
                <Button size="sm" variant="outline">
                  Update
                </Button>
                <Button size="sm" variant="destructive">
                  Uninstall
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
