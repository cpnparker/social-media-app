"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2, ExternalLink, FileText, Search, Brain, RefreshCw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/* ─────────────── Types ─────────────── */

interface ClientContextDialogProps {
  open: boolean;
  onClose: () => void;
}

interface Client {
  id_client: number;
  name_client: string;
}

/** Map the /api/customers response shape to our Client interface */
function mapCustomer(c: any): Client {
  return {
    id_client: Number(c.id ?? c.id_client),
    name_client: c.name ?? c.name_client ?? "",
  };
}

interface FileSummary {
  id_asset: number;
  name: string;
  type: string;
  summary: string;
  chars_extracted: number;
}

interface ClientContext {
  id_context: string;
  id_workspace: string;
  id_client: number;
  document_context: string;
  document_file_summaries: FileSummary[];
  units_asset_count: number;
  date_last_processed: string;
  date_created: string;
  meeting_context?: string | null;
  meeting_context_updated_at?: string | null;
}

/* ─────────────── Main Dialog ─────────────── */

export default function ClientContextDialog({
  open,
  onClose,
}: ClientContextDialogProps) {
  const [clients, setClients] = useState<Client[]>([]);
  const [loadingClients, setLoadingClients] = useState(false);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [comboOpen, setComboOpen] = useState(false);
  const [context, setContext] = useState<ClientContext | null>(null);
  const [loadingContext, setLoadingContext] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Fetch clients list
  useEffect(() => {
    if (!open) return;
    setLoadingClients(true);
    fetch("/api/customers?limit=200")
      .then((r) => r.json())
      .then((data) => {
        const list = (data.customers || data || []).map(mapCustomer);
        list.sort((a: Client, b: Client) =>
          a.name_client.localeCompare(b.name_client)
        );
        setClients(list);
      })
      .catch(() => setClients([]))
      .finally(() => setLoadingClients(false));
  }, [open]);

  // Fetch context when client is selected
  const fetchContext = useCallback(async (clientId: number) => {
    setLoadingContext(true);
    setContext(null);
    try {
      const res = await fetch(`/api/ai/client-context?clientId=${clientId}`);
      const data = await res.json();
      setContext(data.context || null);
    } catch {
      setContext(null);
    } finally {
      setLoadingContext(false);
    }
  }, []);

  const handleRefresh = useCallback(async (clientId: number) => {
    setRefreshing(true);
    try {
      await fetch("/api/ai/client-context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId }),
      });
      await fetchContext(clientId);
    } catch {
      // ignore
    } finally {
      setRefreshing(false);
    }
  }, [fetchContext]);

  useEffect(() => {
    if (selectedClient) {
      fetchContext(selectedClient.id_client);
    }
  }, [selectedClient, fetchContext]);

  // Reset state on close
  useEffect(() => {
    if (!open) {
      setSelectedClient(null);
      setContext(null);
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 pt-5 pb-3">
          <DialogTitle className="text-lg font-semibold flex items-center gap-2">
            <Brain className="h-5 w-5" />
            Client Context
          </DialogTitle>
          <p className="text-sm text-muted-foreground mt-1">
            AI-generated context from client asset files, injected into conversations.
          </p>
        </DialogHeader>

        {/* Client selector */}
        <div className="px-6 pb-3">
          <Popover open={comboOpen} onOpenChange={setComboOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                aria-expanded={comboOpen}
                className="w-full justify-between font-normal"
              >
                {selectedClient
                  ? selectedClient.name_client
                  : "Select a client..."}
                <Search className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
              <Command>
                <CommandInput placeholder="Search clients..." />
                <CommandList>
                  <CommandEmpty>
                    {loadingClients ? "Loading..." : "No clients found."}
                  </CommandEmpty>
                  <CommandGroup>
                    {clients.map((client) => (
                      <CommandItem
                        key={client.id_client}
                        value={client.name_client}
                        onSelect={() => {
                          setSelectedClient(client);
                          setComboOpen(false);
                        }}
                      >
                        {client.name_client}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>

        {/* Content area */}
        <div className="flex-1 overflow-y-auto px-6 pb-6">
          {!selectedClient && (
            <div className="text-center py-12 text-muted-foreground text-sm">
              Select a client to view their AI context profile.
            </div>
          )}

          {selectedClient && loadingContext && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {selectedClient && !loadingContext && !context && (
            <div className="text-center py-12">
              <p className="text-sm text-muted-foreground mb-3">
                No context generated yet for this client.
              </p>
              <p className="text-xs text-muted-foreground mb-4">
                Context is generated automatically when asset files are added.
              </p>
              <Button
                variant="outline"
                size="sm"
                disabled={refreshing}
                onClick={() => handleRefresh(selectedClient.id_client)}
                className="gap-1.5"
              >
                <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
                {refreshing ? "Processing..." : "Generate now"}
              </Button>
            </div>
          )}

          {selectedClient && !loadingContext && context && (
            <div className="space-y-5">
              {/* Actions row */}
              <div className="flex items-center justify-between">
                <a
                  href={`https://app.thecontentengine.com/admin/clients/${selectedClient.id_client}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 hover:underline"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Manage client assets in Engine
                </a>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={refreshing}
                  onClick={() => handleRefresh(selectedClient.id_client)}
                  className="gap-1.5 text-xs"
                >
                  <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
                  {refreshing ? "Checking..." : "Check for changes"}
                </Button>
              </div>

              {/* Processed files */}
              <div>
                <h3 className="text-sm font-medium mb-2">
                  Processed Files ({context.units_asset_count})
                </h3>
                <div className="space-y-1.5">
                  {context.document_file_summaries?.map(
                    (file: FileSummary) => (
                      <a
                        key={file.id_asset}
                        href={`https://app.thecontentengine.com/admin/clients/${selectedClient.id_client}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 px-3 py-2 rounded-md bg-muted/50 hover:bg-muted text-sm transition-colors group"
                      >
                        <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                        <span className="flex-1 truncate">{file.name}</span>
                        <span className="text-xs text-muted-foreground shrink-0">
                          {file.type}
                        </span>
                        <ExternalLink className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 shrink-0" />
                      </a>
                    )
                  )}
                </div>
              </div>

              {/* Linked meetings */}
              {context.meeting_context && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-medium">Linked Meetings</h3>
                    {context.meeting_context_updated_at && (
                      <span className="text-xs text-muted-foreground">
                        Updated:{" "}
                        {new Date(context.meeting_context_updated_at).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                  <div className="rounded-md border bg-blue-50/50 dark:bg-blue-950/20 p-4 text-sm leading-relaxed whitespace-pre-wrap max-h-[200px] overflow-y-auto">
                    {context.meeting_context}
                  </div>
                </div>
              )}

              {/* Generated context */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-medium">Generated Context</h3>
                  <span className="text-xs text-muted-foreground">
                    Last updated:{" "}
                    {new Date(context.date_last_processed).toLocaleDateString()}
                  </span>
                </div>
                <div className="rounded-md border bg-muted/30 p-4 text-sm leading-relaxed whitespace-pre-wrap max-h-[300px] overflow-y-auto">
                  {context.document_context}
                </div>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
