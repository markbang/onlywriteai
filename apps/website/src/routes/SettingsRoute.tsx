import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  getSettings,
  updateAppSettings,
  updateProfile,
  type AppSettings,
} from "../api/documents.ts";

const defaultSettings: AppSettings = {
  defaultDocumentTitle: "Untitled",
  editorLineHeight: "comfortable",
  sourcePanelDefaultOpen: true,
};

export function SettingsRoute() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => getSettings() });
  const [profileName, setProfileName] = useState("");
  const [profilePicture, setProfilePicture] = useState("");
  const [appSettings, setAppSettings] = useState<AppSettings>(defaultSettings);

  useEffect(() => {
    if (!settings.data) {
      return;
    }

    setProfileName(settings.data.profile?.name ?? "");
    setProfilePicture(settings.data.profile?.picture ?? "");
    setAppSettings(settings.data.app);
  }, [settings.data]);

  const profileMutation = useMutation({
    mutationFn: () => updateProfile({ name: profileName, picture: profilePicture }),
    onSuccess: async (profile) => {
      queryClient.setQueryData(["auth"], (current: unknown) =>
        current && typeof current === "object" ? { ...current, user: profile } : current,
      );
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
  });
  const appMutation = useMutation({
    mutationFn: () => updateAppSettings(appSettings),
    onSuccess: async (nextSettings) => {
      setAppSettings(nextSettings);
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
  });

  if (settings.isLoading) {
    return <p className="text-sm text-muted">Loading settings...</p>;
  }

  if (settings.isError) {
    return <p className="text-sm text-danger">Could not load settings.</p>;
  }

  const canEditProfile = Boolean(settings.data?.profile);

  return (
    <section className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Settings</h1>
        <p className="mt-1 text-sm text-muted">Manage your profile and OnlyWrite preferences.</p>
      </div>

      <form
        className="border border-border bg-surface p-4"
        onSubmit={(event) => {
          event.preventDefault();
          profileMutation.mutate();
        }}
      >
        <div className="mb-4 flex items-center gap-3">
          {profilePicture ? (
            <img
              src={profilePicture}
              alt=""
              className="h-12 w-12 rounded object-cover"
              referrerPolicy="no-referrer"
            />
          ) : (
            <span className="flex h-12 w-12 items-center justify-center rounded bg-accent text-sm font-semibold text-accent-foreground">
              {(profileName || settings.data?.profile?.email || "U").slice(0, 1).toUpperCase()}
            </span>
          )}
          <div>
            <h2 className="text-base font-semibold text-foreground">Profile</h2>
            <p className="text-sm text-muted">Profile changes are written back to Logto.</p>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium text-foreground">
            Name
            <input
              className="mt-1 w-full rounded border border-border px-3 py-2 text-sm text-foreground"
              value={profileName}
              disabled={!canEditProfile}
              onChange={(event) => setProfileName(event.currentTarget.value)}
            />
          </label>
          <label className="text-sm font-medium text-foreground">
            Avatar URL
            <input
              className="mt-1 w-full rounded border border-border px-3 py-2 text-sm text-foreground"
              value={profilePicture}
              disabled={!canEditProfile}
              onChange={(event) => setProfilePicture(event.currentTarget.value)}
            />
          </label>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button
            className="inline-flex h-9 w-9 items-center justify-center rounded bg-accent text-accent-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
            type="submit"
            disabled={!canEditProfile || profileMutation.isPending}
            aria-label="Save profile"
            title="Save profile"
          >
            <span
              className={
                profileMutation.isPending
                  ? "i-lucide-loader-circle h-4 w-4 animate-spin"
                  : "i-lucide-user-pen h-4 w-4"
              }
              aria-hidden="true"
            />
          </button>
          {profileMutation.isSuccess ? <p className="text-sm text-muted">Profile saved.</p> : null}
          {profileMutation.isError ? (
            <p className="text-sm text-danger">{profileMutation.error.message}</p>
          ) : null}
        </div>
      </form>

      <form
        className="border border-border bg-surface p-4"
        onSubmit={(event) => {
          event.preventDefault();
          appMutation.mutate();
        }}
      >
        <h2 className="text-base font-semibold text-foreground">OnlyWrite</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium text-foreground">
            Default document title
            <input
              className="mt-1 w-full rounded border border-border px-3 py-2 text-sm text-foreground"
              value={appSettings.defaultDocumentTitle}
              onChange={(event) => {
                const defaultDocumentTitle = event.currentTarget.value;
                setAppSettings((current) => ({
                  ...current,
                  defaultDocumentTitle,
                }));
              }}
            />
          </label>
          <label className="text-sm font-medium text-foreground">
            Editor density
            <select
              className="mt-1 w-full rounded border border-border bg-surface px-3 py-2 text-sm text-foreground"
              value={appSettings.editorLineHeight}
              onChange={(event) => {
                const editorLineHeight = event.currentTarget
                  .value as AppSettings["editorLineHeight"];
                setAppSettings((current) => ({
                  ...current,
                  editorLineHeight,
                }));
              }}
            >
              <option value="compact">Compact</option>
              <option value="comfortable">Comfortable</option>
              <option value="relaxed">Relaxed</option>
            </select>
          </label>
        </div>
        <label className="mt-4 flex items-center gap-2 text-sm font-medium text-foreground">
          <input
            type="checkbox"
            checked={appSettings.sourcePanelDefaultOpen}
            onChange={(event) => {
              const sourcePanelDefaultOpen = event.currentTarget.checked;
              setAppSettings((current) => ({
                ...current,
                sourcePanelDefaultOpen,
              }));
            }}
          />
          Open sources panel by default
        </label>
        <div className="mt-4 flex items-center gap-3">
          <button
            className="inline-flex h-9 w-9 items-center justify-center rounded bg-accent text-accent-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
            type="submit"
            disabled={appMutation.isPending}
            aria-label="Save settings"
            title="Save settings"
          >
            <span
              className={
                appMutation.isPending
                  ? "i-lucide-loader-circle h-4 w-4 animate-spin"
                  : "i-lucide-save h-4 w-4"
              }
              aria-hidden="true"
            />
          </button>
          {appMutation.isSuccess ? <p className="text-sm text-muted">Settings saved.</p> : null}
          {appMutation.isError ? (
            <p className="text-sm text-danger">Could not save settings.</p>
          ) : null}
        </div>
      </form>
    </section>
  );
}
