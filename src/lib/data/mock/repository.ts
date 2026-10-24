import "server-only";
import { io } from "next/cache";
import { DataError } from "../errors";
import type { DokdaeRepository } from "../repository";
import type { MockDb } from "./db";
import * as engine from "./engine";
import { getMockDb } from "./store";

/**
 * 임시 데이터 구현. 로그인한 사용자(actorId)에 묶여 생성된다.
 * getDb로 사용할 DB를 고른다(기본: 개발용 공용 DB, 테스트 모드: 세션별 테스트 공간).
 */
export function createMockRepository(actorId: string | null, getDb: () => MockDb = getMockDb): DokdaeRepository {
  const ctx = (): engine.EngineCtx => {
    if (!actorId) throw new DataError("UNAUTHENTICATED");
    const db = getDb();
    const now = new Date();
    engine.runMaintenance({ db, now });
    return { db, actorId, now };
  };
  // 엔진은 동기 함수이므로, 실제 비동기 데이터 소스와 같은 모양이 되도록 Promise로 감싼다.
  // 동기 엔진에는 await 지점이 없어 사전 렌더링 중에 현재 시각(new Date())을 읽게 된다.
  // io()로 사전 렌더링을 여기서 멈춰, 시각 읽기와 만료 정리가 요청 시점에만 일어나게 한다.
  // (요청 처리·Server Action 안에서는 즉시 resolve된다.)
  const run = async <T>(fn: (c: engine.EngineCtx) => T): Promise<T> => {
    await io();
    return structuredClone(fn(ctx()));
  };

  return {
    listMyRooms: () => run((c) => engine.listMyRooms(c)),
    createRoom: (input) => run((c) => engine.createRoom(c, input)),
    joinRoom: (input) => run((c) => engine.joinRoom(c, input)),
    getRoomDashboard: (roomId) => run((c) => engine.getRoomDashboard(c, roomId)),

    getProfileEditor: (roomId) => run((c) => engine.getProfileEditor(c, roomId)),
    updateProfile: (roomId, input) => run((c) => engine.updateProfile(c, roomId, input)),
    addCustomQuestion: (roomId, input) => run((c) => engine.addCustomQuestion(c, roomId, input)),
    deleteCustomQuestion: (roomId, questionId) => run((c) => engine.deleteCustomQuestion(c, roomId, questionId)),
    getMemberProfile: (roomId, memberId) => run((c) => engine.getMemberProfile(c, roomId, memberId)),

    requestSession: (roomId, recipientId) => run((c) => engine.requestSession(c, roomId, recipientId)),
    respondToSession: (sessionId, accept) => run((c) => engine.respondToSession(c, sessionId, accept)),
    cancelSessionRequest: (sessionId) => run((c) => engine.cancelSessionRequest(c, sessionId)),
    getSessionView: (sessionId) => run((c) => engine.getSessionView(c, sessionId)),
    unlockQuestion: (sessionId, questionId, expectedCost) =>
      run((c) => engine.unlockQuestion(c, sessionId, questionId, expectedCost)),
    sendGift: (sessionId, input) => run((c) => engine.sendGift(c, sessionId, input)),
    voteEndSession: (sessionId) => run((c) => engine.voteEndSession(c, sessionId)),
    cancelEndVote: (sessionId) => run((c) => engine.cancelEndVote(c, sessionId)),

    getRoomAdmin: (roomId) => run((c) => engine.getRoomAdmin(c, roomId)),
    updateRoomInfo: (roomId, input) => run((c) => engine.updateRoomInfo(c, roomId, input)),
    updateRoomSettings: (roomId, settings) => run((c) => engine.updateRoomSettings(c, roomId, settings)),
    regenerateInviteCode: (roomId) => run((c) => engine.regenerateInviteCode(c, roomId)),
    upsertQuestionTemplate: (roomId, input) => run((c) => engine.upsertQuestionTemplate(c, roomId, input)),
    deleteQuestionTemplate: (roomId, templateId) => run((c) => engine.deleteQuestionTemplate(c, roomId, templateId)),
    moveQuestionTemplate: (roomId, templateId, dir) => run((c) => engine.moveQuestionTemplate(c, roomId, templateId, dir)),
    closeRoom: (roomId) => run((c) => engine.closeRoom(c, roomId)),
  };
}
