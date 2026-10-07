import {
  type CapabilityId,
  capabilityId,
  type PresetName,
  presetName,
  type RoleId,
  roleId,
  ValidationError,
} from "./identifiers";

export const MAX_PARTICIPANTS_PER_CAPABILITY = 10_000;

export interface ParticipantDeclaration {
  capability: CapabilityId;
  count: number;
}

export interface Participant {
  role: RoleId;
  capability: CapabilityId;
  preset?: PresetName;
}

export interface ExpandParticipantsOptions {
  includeCoordinator?: boolean;
}

export function parseParticipantDeclaration(
  value: unknown
): ParticipantDeclaration {
  if (typeof value !== "string")
    throw new ValidationError("Participant declaration must be a string");
  const separator = value.indexOf("=");
  const rawCapability = separator < 0 ? value : value.slice(0, separator);
  const rawCount = separator < 0 ? undefined : value.slice(separator + 1);
  if (rawCount?.includes("="))
    throw new ValidationError(`Invalid participant declaration: ${value}`);
  const capability = capabilityId(rawCapability);
  const count = rawCount === undefined ? 1 : parseCount(rawCount, value);
  if (capability === "coordinator" && count > 1)
    throw new ValidationError(
      "coordinator cannot have multiplicity greater than one"
    );
  return { capability, count };
}

export function expandParticipants(
  values: readonly unknown[],
  options: ExpandParticipantsOptions = {}
): Participant[] {
  if (values.length === 0)
    throw new ValidationError("Mission participants must be non-empty");
  const declarations = values.map(parseParticipantDeclaration);
  const capabilities = declarations.map((entry) => entry.capability);
  if (new Set(capabilities).size !== capabilities.length)
    throw new ValidationError("Capability declarations must be unique");

  const participants: Participant[] = [];
  const roles = new Set<RoleId>();
  const add = (role: RoleId, capability: CapabilityId) => {
    if (role === "all")
      throw new ValidationError("Participant identity 'all' is reserved");
    if (roles.has(role))
      throw new ValidationError(`Participant identity collision: ${role}`);
    roles.add(role);
    participants.push({ role, capability });
  };

  for (const declaration of declarations) {
    if (declaration.count === 1) {
      add(roleId(declaration.capability), declaration.capability);
      continue;
    }
    for (let index = 1; index <= declaration.count; index++)
      add(roleId(`${declaration.capability}-${index}`), declaration.capability);
  }

  if (
    options.includeCoordinator !== false &&
    !roles.has(roleId("coordinator"))
  ) {
    participants.unshift({
      role: roleId("coordinator"),
      capability: capabilityId("coordinator"),
    });
  }
  return participants;
}

export function normalizeParticipant(value: {
  role: unknown;
  capability?: unknown;
  preset?: unknown;
}): Participant {
  const role = roleId(value.role);
  const capability = capabilityId(value.capability ?? role);
  return {
    role,
    capability,
    ...(value.preset === undefined ? {} : { preset: presetName(value.preset) }),
  };
}

function parseCount(raw: string, declaration: string): number {
  if (!/^[0-9]+$/.test(raw))
    throw new ValidationError(`Invalid participant count in: ${declaration}`);
  const count = Number(raw);
  if (
    !Number.isSafeInteger(count) ||
    count < 1 ||
    count > MAX_PARTICIPANTS_PER_CAPABILITY
  )
    throw new ValidationError(`Invalid participant count in: ${declaration}`);
  return count;
}
