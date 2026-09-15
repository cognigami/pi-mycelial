import { join, resolve, sep } from "node:path";
import type { MessageId, RoleId, SessionId, TaskId } from "./identifiers";

export class MissionPaths {
  readonly root: string;
  constructor(root: string) {
    this.root = resolve(root);
  }
  missionFile() {
    return this.inRoot("mission.md");
  }
  agentsFile() {
    return this.inRoot("agents.json");
  }
  reposFile() {
    return this.inRoot("repos.json");
  }
  messages() {
    return this.inRoot("messages");
  }
  message(id: MessageId) {
    return join(this.messages(), `${id}.md`);
  }
  inbox(role: RoleId) {
    return this.inRoot("inbox", role);
  }
  marker(role: RoleId, id: MessageId) {
    return join(this.inbox(role), `${id}.json`);
  }
  receipts(id: MessageId) {
    return this.inRoot("receipts", id);
  }
  receipt(id: MessageId, filename: string) {
    return join(this.receipts(id), filename);
  }
  claims() {
    return this.inRoot("claims");
  }
  claim(task: TaskId) {
    return join(this.claims(), `${task}.yaml`);
  }
  lock(task: TaskId) {
    return join(this.claims(), `${task}.lock`);
  }
  cursor(role: RoleId, session: SessionId) {
    return this.inRoot("cursors", role, `${session}.json`);
  }
  roster(role: RoleId, session: SessionId) {
    return this.inRoot("roster", role, `${session}.json`);
  }
  rosterRoot() {
    return this.inRoot("roster");
  }
  private inRoot(...parts: string[]) {
    const result = resolve(this.root, ...parts);
    if (result !== this.root && !result.startsWith(`${this.root}${sep}`))
      throw new Error("Path escapes mission root");
    return result;
  }
}
