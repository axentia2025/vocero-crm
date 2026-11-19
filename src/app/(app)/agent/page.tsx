import { redirect } from "next/navigation";
import { AgentClient } from "@/components/agent/agent-client";
import { canConfigure } from "@/lib/auth/roles";
import { getSessionOrNull } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function AgentPage() {
  // Del propietario: un integrante del equipo no configura al agente.
  const session = await getSessionOrNull();
  if (!canConfigure(session?.role)) redirect("/inbox");
  return <AgentClient />;
}
