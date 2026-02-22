import { Settings } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export default function WorkspaceSettingsPage() {
  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Workspace Settings
        </h1>
        <p className="text-muted-foreground mt-1">
          Manage your workspace name, branding, and preferences
        </p>
      </div>
      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg">General</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="workspace-name">Workspace name</Label>
            <Input
              id="workspace-name"
              defaultValue="My Workspace"
              className="max-w-md"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="workspace-slug">Workspace URL</Label>
            <div className="flex items-center gap-0 max-w-md">
              <span className="text-sm text-muted-foreground bg-muted px-3 py-2 rounded-l-md border border-r-0">
                contentengine.app/
              </span>
              <Input
                id="workspace-slug"
                defaultValue="my-workspace"
                className="rounded-l-none"
              />
            </div>
          </div>
          <Button className="bg-blue-500 hover:bg-blue-600">
            Save changes
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
