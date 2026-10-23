import { beforeEach, describe, expect, it, vi } from "vitest";

// 임시 저장소가 사전 렌더링 규칙(Cache Components)을 지키는지 확인한다.
// 동기 엔진이 현재 시각을 읽기 전에 반드시 io()를 기다려야 한다.

const { io } = vi.hoisted(() => ({ io: vi.fn<() => Promise<void>>() }));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ io }));
vi.mock("./store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./store")>();
  return { ...actual, getMockDb: vi.fn(actual.getMockDb) };
});

const { createMockRepository } = await import("./repository");
const store = await import("./store");

beforeEach(() => {
  vi.mocked(store.getMockDb).mockClear();
  store.resetMockDb();
  vi.mocked(store.getMockDb).mockClear();
});

describe("createMockRepository", () => {
  it("io()가 끝나기 전(사전 렌더링 중)에는 데이터와 현재 시각을 읽지 않는다", async () => {
    io.mockReturnValueOnce(new Promise<void>(() => {}));
    const dateSpy = vi.spyOn(globalThis, "Date");

    void createMockRepository("mock-user-minji").listMyRooms();
    await new Promise((r) => setTimeout(r, 0));

    expect(store.getMockDb).not.toHaveBeenCalled();
    expect(dateSpy).not.toHaveBeenCalled();
    expect(io).toHaveBeenCalled();
    dateSpy.mockRestore();
  });

  it("요청 시점에는 io()가 바로 끝나고 내 모임 목록을 돌려준다", async () => {
    io.mockResolvedValueOnce(undefined);
    const rooms = await createMockRepository("mock-user-minji").listMyRooms();
    expect(rooms.map((r) => r.role)).toEqual(["owner"]);
  });

  it("로그인하지 않았으면 UNAUTHENTICATED로 거부한다", async () => {
    io.mockResolvedValueOnce(undefined);
    await expect(createMockRepository(null).listMyRooms()).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });
});
