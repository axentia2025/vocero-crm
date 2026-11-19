import { redirect } from "next/navigation";
import { LabClient } from "@/components/lab/lab-client";
import { canConfigure } from "@/lib/auth/roles";
import { getSessionOrNull } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function LabPage() {
  // Del propietario: un integrante del equipo no configura al agente.
  const session = await getSessionOrNull();
  if (!canConfigure(session?.role)) redirect("/inbox");
  return <LabClient />;
}
