import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DokdaeRepository } from "../repository";
import type {
  MemberProfileView,
  MyRoomSummary,
  ProfileEditor,
  RoomAdminView,
  RoomDashboard,
  SessionView,
} from "../types";
import { toDataError } from "./errors";

/**
 * Supabase 구현. 로그인 사용자의 세션을 가진 서버 클라이언트로 RPC만 호출한다.
 * 권한·소속·상태·잔액 검증과 정산은 모두 DB 함수(supabase/migrations)가 수행하며,
 * 이 계층은 호출자 ID를 넘기지 않는다(DB가 auth.uid()로 판별).
 */
export function createSupabaseRepository(client: SupabaseClient): DokdaeRepository {
  async function call<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
    const { data, error } = await client.rpc(fn, args);
    if (error) {
      const mapped = toDataError(error);
      if (mapped) throw mapped;
      throw new Error(`Supabase RPC ${fn} 실패: ${error.code ?? ""} ${error.message}`);
    }
    return data as T;
  }
  const done = async (p: Promise<unknown>) => {
    await p;
  };

  return {
    listMyRooms: () => call<MyRoomSummary[]>("list_my_rooms"),
    createRoom: (input) =>
      call("create_room", { p_name: input.name, p_description: input.description, p_nickname: input.nickname }),
    joinRoom: (input) => call("join_room", { p_invite_code: input.inviteCode, p_nickname: input.nickname }),
    getRoomDashboard: (roomId) => call<RoomDashboard>("get_room_dashboard", { p_room_id: roomId }),

    getProfileEditor: (roomId) => call<ProfileEditor>("get_profile_editor", { p_room_id: roomId }),
    updateProfile: (roomId, input) =>
      done(call("update_profile", { p_room_id: roomId, p_nickname: input.nickname, p_questions: input.questions })),
    addCustomQuestion: (roomId, input) =>
      call("add_custom_question", { p_room_id: roomId, p_label: input.label, p_token_cost: input.tokenCost }),
    deleteCustomQuestion: (roomId, questionId) =>
      done(call("delete_custom_question", { p_room_id: roomId, p_question_id: questionId })),
    getMemberProfile: (roomId, memberId) =>
      call<MemberProfileView>("get_member_profile", { p_room_id: roomId, p_member_id: memberId }),

    requestSession: (roomId, recipientId) =>
      call("request_session", { p_room_id: roomId, p_recipient_id: recipientId }),
    respondToSession: (sessionId, accept) =>
      done(call("respond_to_session", { p_session_id: sessionId, p_accept: accept })),
    cancelSessionRequest: (sessionId) => done(call("cancel_session_request", { p_session_id: sessionId })),
    getSessionView: (sessionId) => call<SessionView>("get_session_view", { p_session_id: sessionId }),
    unlockQuestion: (sessionId, questionId, expectedCost) =>
      call("unlock_question", { p_session_id: sessionId, p_question_id: questionId, p_expected_cost: expectedCost }),
    sendGift: (sessionId, input) =>
      call("send_gift", { p_session_id: sessionId, p_amount: input.amount, p_request_id: input.requestId }),
    voteEndSession: (sessionId) => call("vote_end_session", { p_session_id: sessionId }),
    cancelEndVote: (sessionId) => done(call("cancel_end_vote", { p_session_id: sessionId })),

    getRoomAdmin: (roomId) => call<RoomAdminView>("get_room_admin", { p_room_id: roomId }),
    updateRoomInfo: (roomId, input) =>
      done(call("update_room_info", { p_room_id: roomId, p_name: input.name, p_description: input.description })),
    updateRoomSettings: (roomId, settings) =>
      done(call("update_room_settings", { p_room_id: roomId, p_settings: settings })),
    regenerateInviteCode: (roomId) => call("regenerate_invite_code", { p_room_id: roomId }),
    upsertQuestionTemplate: (roomId, input) =>
      done(
        call("upsert_question_template", {
          p_room_id: roomId,
          p_id: input.id ?? null,
          p_label: input.label,
          p_description: input.description,
          p_default_cost: input.defaultCost,
          p_is_active: input.isActive,
        }),
      ),
    deleteQuestionTemplate: (roomId, templateId) =>
      done(call("delete_question_template", { p_room_id: roomId, p_template_id: templateId })),
    moveQuestionTemplate: (roomId, templateId, direction) =>
      done(call("move_question_template", { p_room_id: roomId, p_template_id: templateId, p_direction: direction })),
    closeRoom: (roomId) => done(call("close_room", { p_room_id: roomId })),
  };
}
