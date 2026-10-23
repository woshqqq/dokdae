import { createHash, randomInt, randomUUID } from "node:crypto";
import { DataError } from "../errors";
import { DEFAULT_QUESTION_LABELS, DEFAULT_ROOM_SETTINGS, clampCost, isCostInRange, roomSettingsSchema } from "../settings";
import type {
  EndVoteState,
  MemberProfileView,
  MyRoomSummary,
  OwnQuestion,
  PairSession,
  ProfileEditor,
  QuestionMeta,
  QuestionTemplate,
  RoomAdminView,
  RoomDashboard,
  RoomMember,
  RoomSettings,
  SessionSummary,
  SessionView,
  TransactionType,
} from "../types";
import type { MockDb, MockQuestion, MockRoom, MockTransaction, MockWallet } from "./db";

// 임시 데이터용 규칙 엔진.
// 실제 서비스에서는 같은 규칙을 PostgreSQL RPC(트랜잭션 + 행 잠금)와 RLS가 강제한다.
// 이 엔진은 단일 스레드에서 동기적으로 실행되므로, 모든 검증을 마친 뒤에만 상태를 바꾸는 방식으로
// "전부 성공 또는 전부 실패"를 흉내 낸다.

export interface EngineCtx {
  db: MockDb;
  actorId: string;
  now: Date;
}

const iso = (d: Date) => d.toISOString();
const addMinutes = (d: Date, m: number) => new Date(d.getTime() + m * 60_000);
const addDays = (d: Date, days: number) => new Date(d.getTime() + days * 86_400_000);

// ---------- 초대 코드 ----------

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function normalizeInviteCode(code: string) {
  return code.trim().toUpperCase().replace(/\s+/g, "");
}

export function hashInviteCode(code: string) {
  return createHash("sha256").update(normalizeInviteCode(code)).digest("hex");
}

function generateInviteCode() {
  const pick = () => Array.from({ length: 4 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
  return `${pick()}-${pick()}`;
}

// ---------- 조회 헬퍼 ----------

function findRoom(db: MockDb, roomId: string): MockRoom {
  const room = db.rooms.find((r) => r.id === roomId);
  if (!room) throw new DataError("NOT_FOUND");
  return room;
}

function findMember(db: MockDb, roomId: string, userId: string) {
  return db.members.find((m) => m.roomId === roomId && m.userId === userId) ?? null;
}

function requireMember(db: MockDb, roomId: string, userId: string): RoomMember {
  findRoom(db, roomId);
  const member = findMember(db, roomId, userId);
  if (!member) throw new DataError("NOT_MEMBER");
  return member;
}

function requireOwner(db: MockDb, roomId: string, userId: string) {
  const member = requireMember(db, roomId, userId);
  if (member.role !== "owner") throw new DataError("FORBIDDEN");
  return member;
}

function requireActiveRoom(room: MockRoom) {
  if (room.status !== "active") throw new DataError("ROOM_CLOSED");
}

function settingsOf(db: MockDb, roomId: string): RoomSettings {
  const s = db.settings[roomId];
  if (!s) throw new DataError("NOT_FOUND");
  return s;
}

function walletOf(db: MockDb, roomId: string, userId: string): MockWallet {
  const w = db.wallets.find((x) => x.roomId === roomId && x.userId === userId);
  if (!w) throw new DataError("NOT_FOUND");
  return w;
}

function hasAnswer(db: MockDb, questionId: string) {
  return db.answers.some((a) => a.questionId === questionId && a.answer.trim().length > 0);
}

function toMeta(db: MockDb, q: MockQuestion): QuestionMeta {
  return { ...q, hasAnswer: hasAnswer(db, q.id) };
}

/** 다른 참여자에게 보이는 질문: 활성 템플릿(또는 직접 질문) + 공개 + 답변 있음 */
function isPublicQuestion(db: MockDb, q: MockQuestion) {
  if (!q.isEnabled || !hasAnswer(db, q.id)) return false;
  if (q.templateId === null) return true;
  return db.templates.some((t) => t.id === q.templateId && t.isActive);
}

function publicQuestionsOf(db: MockDb, roomId: string, ownerId: string): QuestionMeta[] {
  return db.questions
    .filter((q) => q.roomId === roomId && q.ownerId === ownerId && isPublicQuestion(db, q))
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((q) => toMeta(db, q));
}

function partnerIdOf(session: PairSession, userId: string) {
  return session.requesterId === userId ? session.recipientId : session.requesterId;
}

function requireParticipant(db: MockDb, sessionId: string, userId: string): PairSession {
  const session = db.sessions.find((s) => s.id === sessionId);
  // 당사자가 아니면 존재 여부도 알려주지 않는다.
  if (!session || (session.requesterId !== userId && session.recipientId !== userId)) {
    throw new DataError("NOT_FOUND");
  }
  return session;
}

function isEnding(session: PairSession) {
  return session.requesterEndAt !== null || session.recipientEndAt !== null;
}

function activeSessionCount(db: MockDb, roomId: string, userId: string) {
  return db.sessions.filter(
    (s) => s.roomId === roomId && s.status === "active" && (s.requesterId === userId || s.recipientId === userId),
  ).length;
}

function openSessionBetween(db: MockDb, roomId: string, a: string, b: string) {
  return (
    db.sessions.find(
      (s) =>
        s.roomId === roomId &&
        (s.status === "pending" || s.status === "active") &&
        ((s.requesterId === a && s.recipientId === b) || (s.requesterId === b && s.recipientId === a)),
    ) ?? null
  );
}

function summarize(db: MockDb, s: PairSession, viewerId: string): SessionSummary {
  const partnerId = partnerIdOf(s, viewerId);
  const partner = findMember(db, s.roomId, partnerId);
  return {
    id: s.id,
    status: s.status,
    partner: { userId: partnerId, nickname: partner?.nickname ?? "(나간 참여자)" },
    isRequester: s.requesterId === viewerId,
    requestedAt: s.requestedAt,
    expiresAt: s.expiresAt,
    endRequested: isEnding(s),
  };
}

function recordTransaction(
  ctx: EngineCtx,
  tx: {
    roomId: string;
    sessionId: string | null;
    senderId: string | null;
    recipientId: string;
    amount: number;
    type: TransactionType;
    questionId?: string | null;
    idempotencyKey?: string | null;
  },
) {
  if (!Number.isInteger(tx.amount) || tx.amount <= 0) throw new DataError("VALIDATION");
  const row: MockTransaction = {
    id: randomUUID(),
    questionId: null,
    idempotencyKey: null,
    ...tx,
    createdAt: iso(ctx.now),
  };
  ctx.db.transactions.push(row);
  return row;
}

/** 두 지갑 사이 이체. 호출 전에 모든 검증이 끝나 있어야 한다. */
function transfer(ctx: EngineCtx, from: MockWallet, to: MockWallet, amount: number) {
  if (from.balance < amount) throw new DataError("INSUFFICIENT_BALANCE");
  from.balance -= amount;
  to.balance += amount;
  from.updatedAt = to.updatedAt = iso(ctx.now);
}

// ---------- 유지보수: 만료·예약 삭제 (실서비스에서는 Cron) ----------

function deleteSessionRecords(db: MockDb, sessionId: string) {
  db.unlocks = db.unlocks.filter((u) => u.sessionId !== sessionId);
  db.transactions = db.transactions.filter((t) => t.sessionId !== sessionId);
  db.sessions = db.sessions.filter((s) => s.id !== sessionId);
}

function deleteRoomRecords(db: MockDb, roomId: string) {
  const questionIds = new Set(db.questions.filter((q) => q.roomId === roomId).map((q) => q.id));
  db.answers = db.answers.filter((a) => !questionIds.has(a.questionId));
  db.questions = db.questions.filter((q) => q.roomId !== roomId);
  db.templates = db.templates.filter((t) => t.roomId !== roomId);
  db.unlocks = db.unlocks.filter((u) => u.roomId !== roomId);
  db.transactions = db.transactions.filter((t) => t.roomId !== roomId);
  db.sessions = db.sessions.filter((s) => s.roomId !== roomId);
  db.wallets = db.wallets.filter((w) => w.roomId !== roomId);
  db.members = db.members.filter((m) => m.roomId !== roomId);
  delete db.settings[roomId];
  db.rooms = db.rooms.filter((r) => r.id !== roomId);
}

/** 독대가 끝나는(종료·거절·취소·만료) 시점에 보관 정책을 적용한다. */
function finishSession(ctx: EngineCtx, session: PairSession) {
  const { sessionRetentionDays } = settingsOf(ctx.db, session.roomId);
  if (sessionRetentionDays === 0) {
    deleteSessionRecords(ctx.db, session.id);
  } else {
    session.purgeAt = iso(addDays(ctx.now, sessionRetentionDays));
  }
}

/** 재실행해도 안전한 정리 작업. 매 요청 시작 시 호출한다. */
export function runMaintenance(ctx: Omit<EngineCtx, "actorId">) {
  const { db, now } = ctx;
  for (const s of [...db.sessions]) {
    if (s.status === "pending" && new Date(s.expiresAt) <= now) {
      s.status = "expired";
      finishSession({ ...ctx, actorId: "system" }, s);
    }
  }
  for (const s of [...db.sessions]) {
    if (s.purgeAt && new Date(s.purgeAt) <= now) deleteSessionRecords(db, s.id);
  }
  for (const r of [...db.rooms]) {
    if (r.status === "closed" && r.purgeAt && new Date(r.purgeAt) <= now) deleteRoomRecords(db, r.id);
  }
}

// ---------- 모임 ----------

function validateNickname(nickname: string) {
  const v = nickname.trim();
  if (v.length < 1 || v.length > 20) throw new DataError("VALIDATION", "닉네임은 1~20자로 입력해 주세요.");
  return v;
}

function ensureMemberQuestions(ctx: EngineCtx, roomId: string, userId: string) {
  const { db } = ctx;
  const settings = settingsOf(db, roomId);
  const mine = db.questions.filter((q) => q.roomId === roomId && q.ownerId === userId);
  for (const t of db.templates.filter((t) => t.roomId === roomId)) {
    if (mine.some((q) => q.templateId === t.id)) continue;
    db.questions.push({
      id: randomUUID(),
      roomId,
      ownerId: userId,
      templateId: t.id,
      label: t.label,
      tokenCost: clampCost(t.defaultCost, settings),
      isEnabled: true,
      sortOrder: t.sortOrder,
    });
  }
}

function addMember(ctx: EngineCtx, room: MockRoom, role: RoomMember["role"], nickname: string) {
  const { db, actorId, now } = ctx;
  const settings = settingsOf(db, room.id);
  db.members.push({ roomId: room.id, userId: actorId, role, nickname, joinedAt: iso(now) });
  const wallet: MockWallet = { roomId: room.id, userId: actorId, balance: 0, updatedAt: iso(now) };
  db.wallets.push(wallet);
  if (settings.initialTokens > 0) {
    wallet.balance = settings.initialTokens;
    recordTransaction(ctx, {
      roomId: room.id,
      sessionId: null,
      senderId: null,
      recipientId: actorId,
      amount: settings.initialTokens,
      type: "initial_grant",
    });
  }
  ensureMemberQuestions(ctx, room.id, actorId);
}

export function createRoom(ctx: EngineCtx, input: { name: string; description: string; nickname: string }) {
  const name = input.name.trim();
  if (name.length < 1 || name.length > 40) throw new DataError("VALIDATION", "모임 이름은 1~40자로 입력해 주세요.");
  const description = input.description.trim().slice(0, 200);
  const nickname = validateNickname(input.nickname);

  const inviteCode = generateInviteCode();
  const room: MockRoom = {
    id: randomUUID(),
    name,
    description,
    ownerId: ctx.actorId,
    status: "active",
    createdAt: iso(ctx.now),
    closedAt: null,
    purgeAt: null,
    inviteCodeHash: hashInviteCode(inviteCode),
  };
  ctx.db.rooms.push(room);
  ctx.db.settings[room.id] = { ...DEFAULT_ROOM_SETTINGS };
  DEFAULT_QUESTION_LABELS.forEach((label, i) => {
    ctx.db.templates.push({
      id: randomUUID(),
      roomId: room.id,
      label,
      description: "",
      defaultCost: DEFAULT_ROOM_SETTINGS.defaultQuestionCost,
      isActive: true,
      sortOrder: i,
    });
  });
  addMember(ctx, room, "owner", nickname);
  return { roomId: room.id, inviteCode };
}

/** 데모 시드 전용: 정해진 초대 코드로 모임을 만든다. */
export function createRoomWithCode(ctx: EngineCtx, input: { name: string; description: string; nickname: string }, code: string) {
  const result = createRoom(ctx, input);
  findRoom(ctx.db, result.roomId).inviteCodeHash = hashInviteCode(code);
  return { roomId: result.roomId, inviteCode: normalizeInviteCode(code) };
}

export function joinRoom(ctx: EngineCtx, input: { inviteCode: string; nickname: string }) {
  const code = normalizeInviteCode(input.inviteCode);
  if (code.length < 4) throw new DataError("INVALID_INVITE_CODE");
  const hash = hashInviteCode(code);
  const room = ctx.db.rooms.find((r) => r.inviteCodeHash === hash);
  if (!room) throw new DataError("INVALID_INVITE_CODE");
  requireActiveRoom(room);
  // 이미 가입한 사용자는 초기 토큰을 다시 받지 않는다.
  if (findMember(ctx.db, room.id, ctx.actorId)) return { roomId: room.id, alreadyMember: true };
  const nickname = validateNickname(input.nickname);
  addMember(ctx, room, "participant", nickname);
  return { roomId: room.id, alreadyMember: false };
}

export function listMyRooms(ctx: EngineCtx): MyRoomSummary[] {
  const { db, actorId } = ctx;
  return db.members
    .filter((m) => m.userId === actorId)
    .map((m) => {
      const room = findRoom(db, m.roomId);
      return {
        room: { id: room.id, name: room.name, description: room.description, status: room.status },
        role: m.role,
        nickname: m.nickname,
        balance: walletOf(db, m.roomId, actorId).balance,
      };
    });
}

export function getRoomDashboard(ctx: EngineCtx, roomId: string): RoomDashboard {
  const { db, actorId } = ctx;
  const me = requireMember(db, roomId, actorId);
  const room = findRoom(db, roomId);
  const settings = settingsOf(db, roomId);
  const mySessions = db.sessions
    .filter((s) => s.roomId === roomId && (s.requesterId === actorId || s.recipientId === actorId))
    .map((s) => summarize(db, s, actorId));
  const { inviteCodeHash: _hash, ...publicRoom } = room;
  void _hash;
  return {
    room: publicRoom,
    settings,
    me,
    balance: walletOf(db, roomId, actorId).balance,
    members:
      settings.memberListVisible || me.role === "owner"
        ? db.members.filter((m) => m.roomId === roomId).sort((a, b) => a.joinedAt.localeCompare(b.joinedAt))
        : null,
    incomingRequests: mySessions.filter((s) => s.status === "pending" && !s.isRequester),
    outgoingRequests: mySessions.filter((s) => s.status === "pending" && s.isRequester),
    activeSessions: mySessions.filter((s) => s.status === "active"),
  };
}

// ---------- 프로필 ----------

export function getProfileEditor(ctx: EngineCtx, roomId: string): ProfileEditor {
  const { db, actorId } = ctx;
  const me = requireMember(db, roomId, actorId);
  const room = findRoom(db, roomId);
  ensureMemberQuestions(ctx, roomId, actorId);
  const settings = settingsOf(db, roomId);
  const activeTemplateIds = new Set(db.templates.filter((t) => t.roomId === roomId && t.isActive).map((t) => t.id));
  const questions: OwnQuestion[] = db.questions
    .filter((q) => q.roomId === roomId && q.ownerId === actorId)
    .filter((q) => q.templateId === null || activeTemplateIds.has(q.templateId))
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((q) => ({
      ...toMeta(db, q),
      answer: db.answers.find((a) => a.questionId === q.id)?.answer ?? "",
    }));
  return {
    room: { id: room.id, name: room.name, status: room.status },
    settings: {
      minQuestionCost: settings.minQuestionCost,
      maxQuestionCost: settings.maxQuestionCost,
      defaultQuestionCost: settings.defaultQuestionCost,
      customQuestionsEnabled: settings.customQuestionsEnabled,
    },
    me,
    questions,
  };
}

export function updateProfile(
  ctx: EngineCtx,
  roomId: string,
  input: { nickname: string; questions: { id: string; answer: string; tokenCost: number; isEnabled: boolean }[] },
) {
  const { db, actorId, now } = ctx;
  const me = requireMember(db, roomId, actorId);
  requireActiveRoom(findRoom(db, roomId));
  const settings = settingsOf(db, roomId);
  const nickname = validateNickname(input.nickname);

  // 1) 전부 검증
  const updates = input.questions.map((u) => {
    const q = db.questions.find((x) => x.id === u.id);
    if (!q || q.roomId !== roomId || q.ownerId !== actorId) throw new DataError("FORBIDDEN");
    if (!isCostInRange(u.tokenCost, settings)) {
      throw new DataError(
        "VALIDATION",
        `열람 비용은 ${settings.minQuestionCost}~${settings.maxQuestionCost} 토큰 사이로 설정해 주세요.`,
      );
    }
    const answer = u.answer.trim();
    if (answer.length > 1000) throw new DataError("VALIDATION", "답변은 1000자 이하로 입력해 주세요.");
    return { q, answer, tokenCost: u.tokenCost, isEnabled: u.isEnabled };
  });

  // 2) 적용
  me.nickname = nickname;
  for (const { q, answer, tokenCost, isEnabled } of updates) {
    q.tokenCost = tokenCost;
    q.isEnabled = isEnabled;
    const existing = db.answers.find((a) => a.questionId === q.id);
    if (answer.length === 0) {
      db.answers = db.answers.filter((a) => a.questionId !== q.id);
    } else if (existing) {
      existing.answer = answer;
      existing.updatedAt = iso(now);
    } else {
      db.answers.push({ questionId: q.id, ownerId: actorId, answer, updatedAt: iso(now) });
    }
  }
}

export function addCustomQuestion(ctx: EngineCtx, roomId: string, input: { label: string; tokenCost: number }) {
  const { db, actorId } = ctx;
  requireMember(db, roomId, actorId);
  requireActiveRoom(findRoom(db, roomId));
  const settings = settingsOf(db, roomId);
  if (!settings.customQuestionsEnabled) throw new DataError("CUSTOM_QUESTIONS_DISABLED");
  const label = input.label.trim();
  if (label.length < 1 || label.length > 100) throw new DataError("VALIDATION", "질문은 1~100자로 입력해 주세요.");
  if (!isCostInRange(input.tokenCost, settings)) throw new DataError("VALIDATION");
  const maxOrder = Math.max(-1, ...db.questions.filter((q) => q.roomId === roomId && q.ownerId === actorId).map((q) => q.sortOrder));
  const id = randomUUID();
  db.questions.push({
    id,
    roomId,
    ownerId: actorId,
    templateId: null,
    label,
    tokenCost: input.tokenCost,
    isEnabled: true,
    sortOrder: maxOrder + 1,
  });
  return { questionId: id };
}

export function deleteCustomQuestion(ctx: EngineCtx, roomId: string, questionId: string) {
  const { db, actorId } = ctx;
  requireMember(db, roomId, actorId);
  const q = db.questions.find((x) => x.id === questionId);
  if (!q || q.roomId !== roomId || q.ownerId !== actorId) throw new DataError("FORBIDDEN");
  if (q.templateId !== null) throw new DataError("INVALID_STATE", "모임 기본 질문은 삭제할 수 없습니다. 비공개로 설정해 주세요.");
  db.answers = db.answers.filter((a) => a.questionId !== questionId);
  db.questions = db.questions.filter((x) => x.id !== questionId);
}

export function getMemberProfile(ctx: EngineCtx, roomId: string, memberId: string): MemberProfileView {
  const { db, actorId } = ctx;
  requireMember(db, roomId, actorId);
  const room = findRoom(db, roomId);
  const settings = settingsOf(db, roomId);
  const member = findMember(db, roomId, memberId);
  if (!member) throw new DataError("NOT_FOUND");
  const isMe = memberId === actorId;
  const open = isMe ? null : openSessionBetween(db, roomId, actorId, memberId);

  let canRequest: MemberProfileView["canRequest"] = { ok: true };
  if (isMe) canRequest = { ok: false, reason: "본인에게는 독대를 요청할 수 없습니다." };
  else if (room.status !== "active") canRequest = { ok: false, reason: "종료된 모임입니다." };
  else if (open) canRequest = { ok: false, reason: "이미 대기 중이거나 진행 중인 독대가 있습니다." };
  else if (activeSessionCount(db, roomId, actorId) >= settings.maxActiveSessionsPerMember)
    canRequest = { ok: false, reason: `동시에 진행할 수 있는 독대는 ${settings.maxActiveSessionsPerMember}개입니다.` };

  return {
    room: { id: room.id, name: room.name, status: room.status },
    member,
    isMe,
    questions: publicQuestionsOf(db, roomId, memberId),
    openSession: open ? summarize(db, open, actorId) : null,
    canRequest,
  };
}

// ---------- 독대 ----------

export function requestSession(ctx: EngineCtx, roomId: string, recipientId: string) {
  const { db, actorId, now } = ctx;
  requireMember(db, roomId, actorId);
  const room = findRoom(db, roomId);
  requireActiveRoom(room);
  if (recipientId === actorId) throw new DataError("SELF_ACTION");
  if (!findMember(db, roomId, recipientId)) throw new DataError("NOT_FOUND");
  const settings = settingsOf(db, roomId);
  if (openSessionBetween(db, roomId, actorId, recipientId)) throw new DataError("SESSION_DUPLICATE");
  if (activeSessionCount(db, roomId, actorId) >= settings.maxActiveSessionsPerMember) throw new DataError("SESSION_LIMIT");

  const session: PairSession = {
    id: randomUUID(),
    roomId,
    requesterId: actorId,
    recipientId,
    status: "pending",
    requestedAt: iso(now),
    expiresAt: iso(addMinutes(now, settings.requestExpiryMinutes)),
    acceptedAt: null,
    closedAt: null,
    requesterEndAt: null,
    recipientEndAt: null,
    purgeAt: null,
  };
  db.sessions.push(session);
  return { sessionId: session.id };
}

export function respondToSession(ctx: EngineCtx, sessionId: string, accept: boolean) {
  const { db, actorId, now } = ctx;
  const session = requireParticipant(db, sessionId, actorId);
  if (session.recipientId !== actorId) throw new DataError("FORBIDDEN");
  if (session.status !== "pending") throw new DataError("INVALID_STATE");
  if (new Date(session.expiresAt) <= now) throw new DataError("SESSION_EXPIRED");
  requireActiveRoom(findRoom(db, session.roomId));

  if (!accept) {
    session.status = "rejected";
    session.closedAt = iso(now);
    finishSession(ctx, session);
    return;
  }
  const { maxActiveSessionsPerMember } = settingsOf(db, session.roomId);
  if (
    activeSessionCount(db, session.roomId, session.requesterId) >= maxActiveSessionsPerMember ||
    activeSessionCount(db, session.roomId, session.recipientId) >= maxActiveSessionsPerMember
  ) {
    throw new DataError("SESSION_LIMIT");
  }
  session.status = "active";
  session.acceptedAt = iso(now);
}

export function cancelSessionRequest(ctx: EngineCtx, sessionId: string) {
  const session = requireParticipant(ctx.db, sessionId, ctx.actorId);
  if (session.requesterId !== ctx.actorId) throw new DataError("FORBIDDEN");
  if (session.status !== "pending") throw new DataError("INVALID_STATE");
  session.status = "cancelled";
  session.closedAt = iso(ctx.now);
  finishSession(ctx, session);
}

export function getSessionView(ctx: EngineCtx, sessionId: string): SessionView {
  const { db, actorId } = ctx;
  const session = requireParticipant(db, sessionId, actorId);
  const room = findRoom(db, session.roomId);
  const settings = settingsOf(db, session.roomId);
  const me = requireMember(db, session.roomId, actorId);
  const partnerId = partnerIdOf(session, actorId);
  const partner = findMember(db, session.roomId, partnerId);
  if (!partner) throw new DataError("NOT_FOUND");

  // 답변 원문은 독대가 active이고 이 독대에서 열람 권한이 있을 때만 내려준다.
  const canReadAnswers = session.status === "active" && room.status === "active";
  const partnerQuestions = publicQuestionsOf(db, session.roomId, partnerId).map((meta) => {
    const unlock = db.unlocks.find((u) => u.sessionId === sessionId && u.questionId === meta.id && u.viewerId === actorId);
    return {
      meta,
      unlocked: Boolean(unlock),
      tokensPaid: unlock?.tokensPaid ?? null,
      answer: unlock && canReadAnswers ? (db.answers.find((a) => a.questionId === meta.id)?.answer ?? null) : null,
    };
  });

  const myEnd = session.requesterId === actorId ? session.requesterEndAt : session.recipientEndAt;
  const partnerEnd = session.requesterId === actorId ? session.recipientEndAt : session.requesterEndAt;
  const endVote: EndVoteState = myEnd
    ? { kind: "requested_by_me", at: myEnd }
    : partnerEnd
      ? { kind: "requested_by_partner", at: partnerEnd }
      : { kind: "none" };

  return {
    session,
    room: { id: room.id, name: room.name, status: room.status },
    settings: {
      giftsEnabled: settings.giftsEnabled,
      giftDefaultAmount: settings.giftDefaultAmount,
      giftMinAmount: settings.giftMinAmount,
      giftMaxAmount: settings.giftMaxAmount,
      sessionRetentionDays: settings.sessionRetentionDays,
    },
    me,
    partner,
    myBalance: walletOf(db, session.roomId, actorId).balance,
    partnerQuestions,
    endVote,
    transactions: db.transactions
      .filter((t) => t.sessionId === sessionId && (t.senderId === actorId || t.recipientId === actorId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(({ idempotencyKey: _k, ...t }) => {
        void _k;
        return t;
      }),
  };
}

function requireTradableSession(ctx: EngineCtx, sessionId: string) {
  const session = requireParticipant(ctx.db, sessionId, ctx.actorId);
  requireActiveRoom(findRoom(ctx.db, session.roomId));
  if (session.status !== "active") throw new DataError("SESSION_NOT_ACTIVE");
  if (isEnding(session)) throw new DataError("SESSION_ENDING");
  return session;
}

export function unlockQuestion(ctx: EngineCtx, sessionId: string, questionId: string, expectedCost?: number) {
  const { db, actorId, now } = ctx;
  const session = requireTradableSession(ctx, sessionId);
  const partnerId = partnerIdOf(session, actorId);

  const q = db.questions.find((x) => x.id === questionId);
  if (!q || q.roomId !== session.roomId) throw new DataError("QUESTION_UNAVAILABLE");
  if (q.ownerId === actorId) throw new DataError("SELF_ACTION");
  if (q.ownerId !== partnerId || !isPublicQuestion(db, q)) throw new DataError("QUESTION_UNAVAILABLE");

  const viewerWallet = walletOf(db, session.roomId, actorId);
  const existing = db.unlocks.find((u) => u.sessionId === sessionId && u.questionId === questionId && u.viewerId === actorId);
  if (existing) return { alreadyUnlocked: true, balance: viewerWallet.balance };

  const cost = q.tokenCost; // 현재 가격. 과거 결제는 소급하지 않는다.
  if (expectedCost !== undefined && expectedCost !== cost) throw new DataError("PRICE_CHANGED");
  const ownerWallet = walletOf(db, session.roomId, partnerId);
  if (viewerWallet.balance < cost) throw new DataError("INSUFFICIENT_BALANCE");

  if (cost > 0) {
    transfer(ctx, viewerWallet, ownerWallet, cost);
    recordTransaction(ctx, {
      roomId: session.roomId,
      sessionId,
      senderId: actorId,
      recipientId: partnerId,
      amount: cost,
      type: "unlock_payment",
      questionId,
    });
  }
  db.unlocks.push({
    id: randomUUID(),
    sessionId,
    roomId: session.roomId,
    questionId,
    viewerId: actorId,
    ownerId: partnerId,
    tokensPaid: cost,
    createdAt: iso(now),
  });
  return { alreadyUnlocked: false, balance: viewerWallet.balance };
}

export function sendGift(ctx: EngineCtx, sessionId: string, input: { amount: number; requestId: string }) {
  const { db, actorId } = ctx;
  const session = requireTradableSession(ctx, sessionId);
  const settings = settingsOf(db, session.roomId);
  if (!settings.giftsEnabled) throw new DataError("GIFTS_DISABLED");
  const requestId = input.requestId.trim();
  if (requestId.length < 8 || requestId.length > 100) throw new DataError("VALIDATION");

  const senderWallet = walletOf(db, session.roomId, actorId);
  const duplicate = db.transactions.some(
    (t) => t.roomId === session.roomId && t.senderId === actorId && t.idempotencyKey === requestId,
  );
  if (duplicate) return { duplicate: true, balance: senderWallet.balance };

  const { amount } = input;
  if (!Number.isInteger(amount) || amount < settings.giftMinAmount || amount > settings.giftMaxAmount) {
    throw new DataError("VALIDATION", `보낼 수 있는 토큰은 ${settings.giftMinAmount}~${settings.giftMaxAmount}개입니다.`);
  }
  const partnerId = partnerIdOf(session, actorId);
  const recipientWallet = walletOf(db, session.roomId, partnerId);
  if (senderWallet.balance < amount) throw new DataError("INSUFFICIENT_BALANCE");

  transfer(ctx, senderWallet, recipientWallet, amount);
  recordTransaction(ctx, {
    roomId: session.roomId,
    sessionId,
    senderId: actorId,
    recipientId: partnerId,
    amount,
    type: "gift",
    idempotencyKey: requestId,
  });
  return { duplicate: false, balance: senderWallet.balance };
}

export function voteEndSession(ctx: EngineCtx, sessionId: string) {
  const { db, actorId, now } = ctx;
  const session = requireParticipant(db, sessionId, actorId);
  if (session.status !== "active") throw new DataError("SESSION_NOT_ACTIVE");
  if (session.requesterId === actorId) session.requesterEndAt ??= iso(now);
  else session.recipientEndAt ??= iso(now);

  if (session.requesterEndAt && session.recipientEndAt) {
    session.status = "closed";
    session.closedAt = iso(now);
    finishSession(ctx, session);
    return { closed: true, roomId: session.roomId };
  }
  return { closed: false, roomId: session.roomId };
}

export function cancelEndVote(ctx: EngineCtx, sessionId: string) {
  const session = requireParticipant(ctx.db, sessionId, ctx.actorId);
  if (session.status !== "active") throw new DataError("SESSION_NOT_ACTIVE");
  session.requesterEndAt = null;
  session.recipientEndAt = null;
}

// ---------- 운영자 ----------

export function getRoomAdmin(ctx: EngineCtx, roomId: string): RoomAdminView {
  const { db, actorId } = ctx;
  requireOwner(db, roomId, actorId);
  const { inviteCodeHash: _hash, ...room } = findRoom(db, roomId);
  void _hash;
  return {
    room,
    settings: settingsOf(db, roomId),
    templates: db.templates.filter((t) => t.roomId === roomId).sort((a, b) => a.sortOrder - b.sortOrder),
    memberCount: db.members.filter((m) => m.roomId === roomId).length,
  };
}

export function updateRoomInfo(ctx: EngineCtx, roomId: string, input: { name: string; description: string }) {
  requireOwner(ctx.db, roomId, ctx.actorId);
  const name = input.name.trim();
  if (name.length < 1 || name.length > 40) throw new DataError("VALIDATION", "모임 이름은 1~40자로 입력해 주세요.");
  const room = findRoom(ctx.db, roomId);
  room.name = name;
  room.description = input.description.trim().slice(0, 200);
}

export function updateRoomSettings(ctx: EngineCtx, roomId: string, next: RoomSettings) {
  const { db, actorId } = ctx;
  requireOwner(db, roomId, actorId);
  const parsed = roomSettingsSchema.safeParse(next);
  if (!parsed.success) throw new DataError("VALIDATION", parsed.error.issues[0]?.message);
  db.settings[roomId] = parsed.data;
  // 새 범위를 벗어난 기존 질문 비용은 범위 안으로 맞춘다(이미 결제된 열람에는 영향 없음).
  for (const q of db.questions.filter((x) => x.roomId === roomId)) q.tokenCost = clampCost(q.tokenCost, parsed.data);
  for (const t of db.templates.filter((x) => x.roomId === roomId)) t.defaultCost = clampCost(t.defaultCost, parsed.data);
}

export function regenerateInviteCode(ctx: EngineCtx, roomId: string) {
  requireOwner(ctx.db, roomId, ctx.actorId);
  const room = findRoom(ctx.db, roomId);
  requireActiveRoom(room);
  const inviteCode = generateInviteCode();
  room.inviteCodeHash = hashInviteCode(inviteCode);
  return { inviteCode };
}

export function upsertQuestionTemplate(
  ctx: EngineCtx,
  roomId: string,
  input: Omit<QuestionTemplate, "id" | "roomId" | "sortOrder"> & { id?: string },
) {
  const { db, actorId } = ctx;
  requireOwner(db, roomId, actorId);
  const settings = settingsOf(db, roomId);
  const label = input.label.trim();
  if (label.length < 1 || label.length > 100) throw new DataError("VALIDATION", "질문은 1~100자로 입력해 주세요.");
  if (!isCostInRange(input.defaultCost, settings)) {
    throw new DataError("VALIDATION", `기본 비용은 ${settings.minQuestionCost}~${settings.maxQuestionCost} 토큰 사이여야 합니다.`);
  }
  const description = input.description.trim().slice(0, 200);
  if (input.id) {
    const t = db.templates.find((x) => x.id === input.id && x.roomId === roomId);
    if (!t) throw new DataError("NOT_FOUND");
    Object.assign(t, { label, description, defaultCost: input.defaultCost, isActive: input.isActive });
    for (const q of db.questions.filter((x) => x.templateId === t.id)) q.label = label;
    return;
  }
  const maxOrder = Math.max(-1, ...db.templates.filter((t) => t.roomId === roomId).map((t) => t.sortOrder));
  db.templates.push({
    id: randomUUID(),
    roomId,
    label,
    description,
    defaultCost: input.defaultCost,
    isActive: input.isActive,
    sortOrder: maxOrder + 1,
  });
}

export function deleteQuestionTemplate(ctx: EngineCtx, roomId: string, templateId: string) {
  const { db, actorId } = ctx;
  requireOwner(db, roomId, actorId);
  if (!db.templates.some((t) => t.id === templateId && t.roomId === roomId)) throw new DataError("NOT_FOUND");
  const questionIds = new Set(db.questions.filter((q) => q.templateId === templateId).map((q) => q.id));
  db.answers = db.answers.filter((a) => !questionIds.has(a.questionId));
  db.questions = db.questions.filter((q) => q.templateId !== templateId);
  db.templates = db.templates.filter((t) => t.id !== templateId);
}

export function moveQuestionTemplate(ctx: EngineCtx, roomId: string, templateId: string, direction: "up" | "down") {
  const { db, actorId } = ctx;
  requireOwner(db, roomId, actorId);
  const list = db.templates.filter((t) => t.roomId === roomId).sort((a, b) => a.sortOrder - b.sortOrder);
  const i = list.findIndex((t) => t.id === templateId);
  if (i < 0) throw new DataError("NOT_FOUND");
  const j = direction === "up" ? i - 1 : i + 1;
  if (j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  list.forEach((t, order) => {
    t.sortOrder = order;
    for (const q of db.questions.filter((x) => x.templateId === t.id)) q.sortOrder = order;
  });
}

export function closeRoom(ctx: EngineCtx, roomId: string) {
  const { db, actorId, now } = ctx;
  requireOwner(db, roomId, actorId);
  const room = findRoom(db, roomId);
  if (room.status === "closed") return;
  for (const s of db.sessions.filter((x) => x.roomId === roomId)) {
    if (s.status === "pending") s.status = "cancelled";
    if (s.status === "active") s.status = "closed";
    s.closedAt ??= iso(now);
  }
  room.status = "closed";
  room.closedAt = iso(now);
  const { roomRetentionDays } = settingsOf(db, roomId);
  if (roomRetentionDays === 0) deleteRoomRecords(db, roomId);
  else room.purgeAt = iso(addDays(now, roomRetentionDays));
}
