import { Users } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export default function TeamSettingsPage() {
  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Team Members</h1>
        <p className="text-muted-foreground mt-1">
          Invite and manage your team members and their roles
        </p>
      </div>
      <Card className="border-dashed border-2 border-muted-foreground/20">
        <CardContent className="flex flex-col items-center justify-center py-12 text-center">
          <div className="h-14 w-14 rounded-full bg-violet-500/10 flex items-center justify-center mb-4">
            <Users className="h-6 w-6 text-violet-500" />
          </div>
          <h3 className="text-lg font-semibold mb-1">Team management coming soon</h3>
          <p className="text-sm text-muted-foreground max-w-sm">
            Invite team members, set roles, and manage permissions.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
