import { AppShell } from "./components/AppShell";
import { EmptyState } from "./components/EmptyState";

export function App() {
  return (
    <AppShell>
      <EmptyState
        title="No connections yet"
        description="Press ⌘K / Ctrl+K to connect to a host." />
    </AppShell>
  );
}
