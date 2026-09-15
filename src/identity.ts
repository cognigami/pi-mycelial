import { join } from "node:path";
import {
  type MissionId,
  missionId,
  type RoleId,
  roleId,
  type SessionId,
  sessionId,
  ValidationError,
} from "./identifiers";
export interface IdentityInputs {
  flagMission?: unknown;
  flagRole?: unknown;
  flagSession?: unknown;
  env?: NodeJS.ProcessEnv;
  hostSession?: string;
}
export interface BoundIdentity {
  mission: MissionId;
  role: RoleId;
  session: SessionId;
  root: string;
}
export function resolveIdentity(
  inputs: IdentityInputs,
  missionRoot: string
): BoundIdentity | undefined {
  const env = inputs.env ?? process.env;
  const mission = inputs.flagMission ?? env.PI_MYCELIAL_MISSION;
  const role = inputs.flagRole ?? env.PI_MYCELIAL_ROLE;
  const explicitSession = inputs.flagSession ?? env.PI_MYCELIAL_SESSION;
  if (
    mission === undefined &&
    role === undefined &&
    explicitSession === undefined
  )
    return undefined;
  if (mission === undefined || role === undefined)
    throw new ValidationError("Mycelial mission and role must both be bound");
  const session = explicitSession ?? inputs.hostSession;
  if (session === undefined)
    throw new ValidationError("Mycelial requires a trusted session identity");
  const parsedMission = missionId(mission);
  return {
    mission: parsedMission,
    role: roleId(role),
    session: sessionId(session),
    root: join(missionRoot, parsedMission),
  };
}
