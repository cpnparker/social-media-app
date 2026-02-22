import { CreditCard } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export default function BillingPage() {
  return (
    <div className="space-y-6 max-w-2xl">
      <Card className="border-dashed border-2 border-muted-foreground/20">
        <CardContent className="flex flex-col items-center justify-center py-12 text-center">
          <div className="h-14 w-14 rounded-full bg-emerald-500/10 flex items-center justify-center mb-4">
            <CreditCard className="h-6 w-6 text-emerald-500" />
          </div>
          <h3 className="text-lg font-semibold mb-1">Billing coming soon</h3>
          <p className="text-sm text-muted-foreground max-w-sm">
            View your plan, usage, and manage payment methods.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
