import type { MuteApplyResult, MuteRule, MuteRulePreview } from "@/types/muteRules";
import { invokeCommand } from "./core";

export async function get(): Promise<MuteRule[]> {
  return invokeCommand<MuteRule[]>("mute_rules_get");
}

export async function set(rules: MuteRule[]): Promise<MuteRule[]> {
  return invokeCommand<MuteRule[]>("mute_rules_set", { rules });
}

export async function preview(rule: MuteRule): Promise<MuteRulePreview> {
  return invokeCommand<MuteRulePreview>("mute_rules_preview", { rule });
}

export async function applyToExisting(): Promise<MuteApplyResult> {
  return invokeCommand<MuteApplyResult>("mute_rules_apply_to_existing");
}
