"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Archive,
  ArchiveRestore,
  BotOff,
  MessageSquareText,
  Search,
  Send,
  Trash2,
  Upload,
  UserPlus,
  Users,
} from "lucide-react";
import type { ContactDto } from "@/lib/types";
import { formatPhone } from "@/lib/utils";
import { ContactAvatar } from "@/components/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SOURCE_LABELS } from "@/server/contact-source";
import { priorityRank } from "@/server/leads/priority";
import { PriorityBadge } from "@/components/pipeline/priority-picker";
import { ImportContactsDialog } from "./import-contacts-dialog";
import { NewContactDialog } from "./new-contact-dialog";
import { StartConversation } from "./start-conversation";

export function ContactsClient() {
  const router = useRouter();
  const [contacts, setContacts] = useState<ContactDto[]>([]);
  const [query, setQuery] = useState("");
  const [stage, setStage] = useState("all");
  const [stages, setStages] = useState<string[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<ContactDto | null>(null);
  const [deleting, setDeleting] = useState<ContactDto | null>(null);
  const [creando, setCreando] = useState(false);
  const [importando, setImportando] = useState(false);
  const [escribiendo, setEscribiendo] = useState<ContactDto | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Mismo rescate que en la Bandeja: lo tecleado antes de que hidrate el JS
  // se perdía en silencio. Ver conversation-list.tsx.
  useEffect(() => {
    const typed = inputRef.current?.value ?? "";
    if (typed) setQuery(typed);
  }, []);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/pipeline/stages").catch(() => null);
      if (!res?.ok) return;
      const data = (await res.json()) as { stages: { name: string }[] };
      setStages(data.stages.map((s) => s.name));
    })();
  }, []);

  const refetch = useCallback(async () => {
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (stage !== "all") params.set("stage", stage);
    if (showArchived) params.set("archived", "true");
    const res = await fetch(`/api/contacts?${params}`).catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as { contacts: ContactDto[] };
    // A quién llamar primero: alta arriba, sin prioridad al final. El orden lo
    // decide esta lista, no el servidor, porque es una preferencia de trabajo y
    // no un dato del contacto.
    setContacts(
      [...data.contacts].sort(
        (a, b) => priorityRank(a.priority ?? null) - priorityRank(b.priority ?? null)
      )
    );
  }, [query, stage, showArchived]);

  useEffect(() => {
    const t = setTimeout(() => void refetch(), 250);
    return () => clearTimeout(t);
  }, [refetch]);

  async function patch(id: string, body: Record<string, unknown>) {
    await fetch(`/api/contacts/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    void refetch();
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 sm:gap-4 sm:px-6 sm:py-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-[17px] font-bold tracking-tight">Contactos</h2>
          <Button size="sm" onClick={() => setCreando(true)}>
            <UserPlus className="mr-1.5 h-4 w-4" strokeWidth={1.8} />
            Nuevo contacto
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setImportando(true)}>
            <Upload className="mr-1.5 h-4 w-4" strokeWidth={1.8} />
            Importar
          </Button>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:gap-3">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
              className="accent-primary"
            />
            Ver archivados
          </label>
          {stages.length > 0 && (
            <select
              value={stage}
              onChange={(e) => setStage(e.target.value)}
              aria-label="Filtrar por etapa del embudo"
              className="h-9 rounded-md border border-input bg-card px-2 text-sm"
            >
              <option value="all">Toda etapa</option>
              {stages.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          )}
          <div className="relative w-full sm:w-auto">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              ref={inputRef}
              placeholder="Buscar por nombre o teléfono…"
              aria-label="Buscar contacto"
              defaultValue=""
              onChange={(e) => setQuery(e.target.value)}
              className="w-full pl-8 sm:w-72"
            />
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        {contacts.length === 0 ? (
          query.trim() || stage !== "all" ? (
            <EmptyState
              icon={Search}
              className="h-full"
              title="Sin resultados"
              description={
                <>
                  Nadie coincide con
                  {query.trim() ? ` «${query.trim()}»` : ""}
                  {query.trim() && stage !== "all" ? " en" : ""}
                  {stage !== "all" ? ` la etapa «${stage}»` : ""}.
                </>
              }
            />
          ) : (
            <EmptyState
              icon={Users}
              className="h-full"
              title="Sin contactos"
              description="Cada persona que escriba a tu WhatsApp quedará registrada aquí automáticamente."
            />
          )
        ) : (
          <ul className="space-y-2">
            {contacts.map((c) => (
              <li
                key={c.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border bg-card px-3 py-3 sm:flex-nowrap sm:gap-x-4 sm:px-4"
              >
                <ContactAvatar name={c.name} seed={c.id} />
                {/* El 60% mínimo es lo que empuja los botones a su propio
                    renglón en el teléfono en vez de exprimir el nombre. */}
                <div className="min-w-[60%] flex-1 sm:min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium">
                      {c.name}
                    </span>
                    {c.priority && <PriorityBadge value={c.priority} />}
                    {c.stageName && (
                      <Badge variant="outline">{c.stageName}</Badge>
                    )}
                    {c.archivedAt && (
                      <Badge variant="secondary">Archivado</Badge>
                    )}
                    {c.aiPaused && (
                      <Badge
                        variant="warning"
                        title="El agente no le responde a este contacto: lo atiendes tú"
                      >
                        <BotOff className="mr-1 h-3 w-3" strokeWidth={1.8} />
                        Sin agente
                      </Badge>
                    )}
                    {/* Solo la fuente que alguien capturó: presentar una
                        deducción como dato la volvería un número inventado en
                        cuanto se cuente por fuente. */}
                    {c.source?.source === "capturada" && (
                      <Badge variant="secondary">
                        {SOURCE_LABELS[c.source.value]}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {c.ficha?.empresa ? `${c.ficha.empresa} · ` : ""}
                    {formatPhone(c.phone)}
                    {c.email ? ` · ${c.email}` : ""}
                    {c.notes ? ` · ${c.notes.slice(0, 60)}` : ""}
                  </p>
                </div>
                <div className="ml-auto flex shrink-0 items-center gap-1.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditing(c)}
                  >
                    Editar
                  </Button>
                  {/* A quien nunca escribió hay que abrirle la conversación con
                      una plantilla: es regla de Meta, no del CRM. */}
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Escribir primero"
                    title="Escribir primero (con plantilla)"
                    onClick={() => setEscribiendo(c)}
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                  <Link href={`/inbox?contact=${c.id}`}>
                    <Button variant="ghost" size="icon" aria-label="Abrir conversación">
                      <MessageSquareText className="h-4 w-4" />
                    </Button>
                  </Link>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={c.archivedAt ? "Desarchivar" : "Archivar"}
                    onClick={() => void patch(c.id, { archived: !c.archivedAt })}
                  >
                    {c.archivedAt ? (
                      <ArchiveRestore className="h-4 w-4" />
                    ) : (
                      <Archive className="h-4 w-4" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Eliminar contacto"
                    title="Eliminar contacto"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setDeleting(c)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {editing && (
        <EditDialog
          contact={editing}
          onClose={() => setEditing(null)}
          onSave={async (patchBody) => {
            await patch(editing.id, patchBody);
            setEditing(null);
          }}
        />
      )}

      {deleting && (
        <DeleteDialog
          contact={deleting}
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await fetch(`/api/contacts/${deleting.id}`, {
              method: "DELETE",
            }).catch(() => null);
            setDeleting(null);
            void refetch();
          }}
        />
      )}

      {escribiendo && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Escribir primero"
        >
          <div className="w-full max-w-md rounded-lg border bg-popover p-4 shadow-pop">
            <div className="mb-3 flex items-baseline justify-between gap-2">
              <h3 className="font-semibold">
                Escribir a {escribiendo.name}
              </h3>
              <Button variant="ghost" size="sm" onClick={() => setEscribiendo(null)}>
                Cerrar
              </Button>
            </div>
            <StartConversation
              contactId={escribiendo.id}
              onStarted={() => {
                const contactId = escribiendo.id;
                setEscribiendo(null);
                // La Bandeja resuelve por CONTACTO (`?contact=`), no por
                // conversación: con `?conversation=` no seleccionaría nada.
                router.push(`/inbox?contact=${contactId}`);
              }}
            />
          </div>
        </div>
      )}

      {importando && (
        <ImportContactsDialog
          onClose={() => setImportando(false)}
          onImported={() => void refetch()}
        />
      )}

      {creando && (
        <NewContactDialog
          onClose={() => setCreando(false)}
          onCreated={() => {
            setCreando(false);
            void refetch();
          }}
          onOpenExisting={(contactId) => {
            setCreando(false);
            router.push(`/inbox?contact=${contactId}`);
          }}
          onEditExisting={(contactId) => {
            setCreando(false);
            const found = contacts.find((c) => c.id === contactId);
            if (found) {
              setEditing(found);
              return;
            }
            void fetch(`/api/contacts/${contactId}`)
              .then((r) => (r.ok ? r.json() : null))
              .then((data: { contact: ContactDto } | null) => {
                if (data?.contact) setEditing(data.contact);
              })
              .catch(() => null);
          }}
        />
      )}
    </div>
  );
}

function EditDialog({
  contact,
  onClose,
  onSave,
}: {
  contact: ContactDto;
  onClose: () => void;
  onSave: (patch: {
    name: string;
    notes: string;
    email?: string | null;
    aiPaused?: boolean;
    ficha?: Record<string, unknown>;
  }) => Promise<void>;
}) {
  const [name, setName] = useState(contact.name);
  const [empresa, setEmpresa] = useState(
    (contact.ficha?.empresa as string) ?? ""
  );
  const [email, setEmail] = useState(contact.email ?? "");
  const [servicios, setServicios] = useState(contact.notes ?? "");
  const [fechaIngreso, setFechaIngreso] = useState(
    (contact.ficha?.fechaIngreso as string) ?? ""
  );
  const [fechaFirma, setFechaFirma] = useState(
    (contact.ficha?.fechaFirma as string) ?? ""
  );
  const [costoImpl, setCostoImpl] = useState(
    (contact.ficha?.costoImplementacion as string) ?? ""
  );
  const [costoMensual, setCostoMensual] = useState(
    (contact.ficha?.costoMensual as string) ?? ""
  );
  const [etapa, setEtapa] = useState(
    (contact.ficha?.etapa as string) ?? ""
  );
  const [aiPaused, setAiPaused] = useState(contact.aiPaused ?? false);

  const ETAPAS = ["Interesado", "En Proceso", "POC", "Cliente Actual"];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-overlay p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-lg border bg-popover p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-4 font-semibold">Editar contacto</h3>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="edit-name">
                Contacto
              </label>
              <Input
                id="edit-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="edit-empresa">
                Empresa
              </label>
              <Input
                id="edit-empresa"
                value={empresa}
                onChange={(e) => setEmpresa(e.target.value)}
                placeholder="Nombre de la empresa"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="edit-email">
              Correo electrónico
            </label>
            <Input
              id="edit-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="correo@ejemplo.com"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="edit-etapa">
              Etapa
            </label>
            <select
              id="edit-etapa"
              value={etapa}
              onChange={(e) => setEtapa(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm"
            >
              <option value="">Sin etapa</option>
              {ETAPAS.map((et) => (
                <option key={et} value={et}>
                  {et}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="edit-servicios">
              Servicios Contratados
            </label>
            <Textarea
              id="edit-servicios"
              rows={2}
              value={servicios}
              onChange={(e) => setServicios(e.target.value)}
              placeholder="CRM + Agente de WhatsApp…"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="edit-fecha-ingreso">
                Fecha de Ingreso
              </label>
              <Input
                id="edit-fecha-ingreso"
                type="date"
                value={fechaIngreso}
                onChange={(e) => setFechaIngreso(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="edit-fecha-firma">
                Fecha de Firma
              </label>
              <Input
                id="edit-fecha-firma"
                type="date"
                value={fechaFirma}
                onChange={(e) => setFechaFirma(e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="edit-costo-impl">
                Costo de Implementación
              </label>
              <Input
                id="edit-costo-impl"
                type="text"
                inputMode="decimal"
                value={costoImpl}
                onChange={(e) => setCostoImpl(e.target.value)}
                placeholder="$15,000"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="edit-costo-mensual">
                Costo Mensual Sin IVA
              </label>
              <Input
                id="edit-costo-mensual"
                type="text"
                inputMode="decimal"
                value={costoMensual}
                onChange={(e) => setCostoMensual(e.target.value)}
                placeholder="$3,500"
              />
            </div>
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={aiPaused}
              onChange={(e) => setAiPaused(e.target.checked)}
              className="mt-0.5 accent-primary"
            />
            <span>
              El agente no le responde
              <span className="block text-[11px] text-text-3">
                Sus mensajes llegan a la Bandeja y los atiendes tú.
              </span>
            </span>
          </label>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={!name.trim()}
            onClick={() => {
              const fichaPatch: Record<string, unknown> = {};
              fichaPatch.empresa = empresa.trim() || null;
              fichaPatch.etapa = etapa || null;
              fichaPatch.fechaIngreso = fechaIngreso || null;
              fichaPatch.fechaFirma = fechaFirma || null;
              fichaPatch.costoImplementacion = costoImpl.trim() || null;
              fichaPatch.costoMensual = costoMensual.trim() || null;
              void onSave({
                name: name.trim(),
                notes: servicios,
                email: email.trim() || null,
                ficha: fichaPatch,
                ...(aiPaused !== (contact.aiPaused ?? false)
                  ? { aiPaused }
                  : {}),
              });
            }}
          >
            Guardar
          </Button>
        </div>
      </div>
    </div>
  );
}

function DeleteDialog({
  contact,
  onClose,
  onConfirm,
}: {
  contact: ContactDto;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [loading, setLoading] = useState(false);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-lg border bg-popover p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-2 font-semibold">Eliminar contacto</h3>
        <p className="text-sm text-muted-foreground">
          ¿Eliminar a <strong>{contact.name}</strong>? Se borrarán también sus
          conversaciones y mensajes. Esta acción no se puede deshacer.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Cancelar
          </Button>
          <Button
            variant="destructive"
            disabled={loading}
            onClick={async () => {
              setLoading(true);
              await onConfirm();
            }}
          >
            {loading ? "Eliminando…" : "Eliminar"}
          </Button>
        </div>
      </div>
    </div>
  );
}
