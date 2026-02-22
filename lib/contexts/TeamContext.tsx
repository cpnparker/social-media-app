"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";

export interface TeamAccount {
  id: string;
  lateAccountId: string;
  platform: string;
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
}

export interface Team {
  id: string;
  name: string;
  description: string | null;
  workspaceId: string;
  memberCount: number;
  accountCount: number;
}

interface TeamContextValue {
  teams: Team[];
  selectedTeam: Team | null;
  selectedTeamId: string | null; // "all" or team id
  teamAccounts: TeamAccount[];
  loading: boolean;
  setSelectedTeam: (teamId: string | null) => void;
  refreshTeams: () => Promise<void>;
}

const TeamContext = createContext<TeamContextValue | null>(null);

export function useTeam() {
  const ctx = useContext(TeamContext);
  if (!ctx) {
    throw new Error("useTeam must be used within a TeamProvider");
  }
  return ctx;
}

// Safe hook that doesn't throw if outside provider
export function useTeamSafe() {
  return useContext(TeamContext);
}

const STORAGE_KEY = "selected-team-id";

export function TeamProvider({ children }: { children: ReactNode }) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [teamAccounts, setTeamAccounts] = useState<TeamAccount[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchTeams = useCallback(async () => {
    try {
      const res = await fetch("/api/teams");
      if (!res.ok) return;
      const data = await res.json();
      setTeams(data.teams || []);

      // Restore selected team from localStorage
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && (stored === "all" || data.teams?.some((t: Team) => t.id === stored))) {
        setSelectedTeamId(stored);
      } else if (data.teams?.length > 0) {
        // Default to first team
        setSelectedTeamId(data.teams[0].id);
      }
    } catch {
      // fail silently
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTeams();
  }, [fetchTeams]);

  // Fetch accounts when selected team changes
  useEffect(() => {
    if (!selectedTeamId || selectedTeamId === "all") {
      // For "all", fetch accounts from all teams
      if (selectedTeamId === "all" && teams.length > 0) {
        Promise.all(
          teams.map((t) =>
            fetch(`/api/teams/${t.id}/accounts`)
              .then((r) => r.json())
              .then((d) => d.accounts || [])
              .catch(() => [])
          )
        ).then((results) => {
          // Deduplicate by lateAccountId
          const seen = new Set<string>();
          const all: TeamAccount[] = [];
          results.flat().forEach((acc: TeamAccount) => {
            if (!seen.has(acc.lateAccountId)) {
              seen.add(acc.lateAccountId);
              all.push(acc);
            }
          });
          setTeamAccounts(all);
        });
      } else {
        setTeamAccounts([]);
      }
      return;
    }

    fetch(`/api/teams/${selectedTeamId}/accounts`)
      .then((r) => r.json())
      .then((d) => setTeamAccounts(d.accounts || []))
      .catch(() => setTeamAccounts([]));
  }, [selectedTeamId, teams]);

  const setSelectedTeam = useCallback((teamId: string | null) => {
    setSelectedTeamId(teamId);
    if (teamId) {
      localStorage.setItem(STORAGE_KEY, teamId);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const selectedTeam = teams.find((t) => t.id === selectedTeamId) || null;

  return (
    <TeamContext.Provider
      value={{
        teams,
        selectedTeam,
        selectedTeamId,
        teamAccounts,
        loading,
        setSelectedTeam,
        refreshTeams: fetchTeams,
      }}
    >
      {children}
    </TeamContext.Provider>
  );
}
