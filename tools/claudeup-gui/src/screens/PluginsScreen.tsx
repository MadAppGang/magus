import { useState } from "react";
import { usePlugins, useEnablePlugin, useDisablePlugin, useRefreshMarketplaces } from "../hooks/usePlugins";
import { useProgress } from "../hooks/useProgress";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Progress } from "../components/ui/progress";

export function PluginsScreen() {
  const [scope, setScope] = useState<"global" | "project">("project");
  const [searchQuery, setSearchQuery] = useState("");

  const { data: plugins, isLoading, error } = usePlugins(scope);
  const enableMutation = useEnablePlugin();
  const disableMutation = useDisablePlugin();
  const refreshMutation = useRefreshMarketplaces();
  const progress = useProgress();

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
