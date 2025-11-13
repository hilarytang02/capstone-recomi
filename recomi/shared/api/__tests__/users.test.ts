jest.mock("firebase/app", () => ({
  initializeApp: jest.fn(() => ({})),
  getApps: jest.fn(() => []),
  getApp: jest.fn(() => ({})),
}));

jest.mock("firebase/auth", () => ({
  getAuth: jest.fn(() => ({})),
  initializeAuth: jest.fn(() => ({})),
  getReactNativePersistence: jest.fn(() => ({})),
}));

jest.mock("@react-native-async-storage/async-storage", () => ({}));

function createFirestoreMock() {
  const transaction = {
    get: jest.fn(),
    set: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };

  const mock = {
    getFirestore: jest.fn(() => ({ __type: "db" })),
    doc: jest.fn(),
    collection: jest.fn(),
    getDoc: jest.fn(),
    getDocs: jest.fn(),
    query: jest.fn((...args) => args),
    where: jest.fn(),
    orderBy: jest.fn(),
    limit: jest.fn(),
    startAfter: jest.fn(),
    runTransaction: jest.fn((_db, updater) => updater(transaction)),
    increment: jest.fn((value: number) => ({ __op: "increment", value })),
    serverTimestamp: jest.fn(() => "timestamp"),
    setDoc: jest.fn(),
    __transaction: transaction,
  };

  return mock;
}

jest.mock("firebase/firestore", () => createFirestoreMock());

const firestoreMock = jest.requireMock("firebase/firestore") as ReturnType<typeof createFirestoreMock>;
const mockTransaction = firestoreMock.__transaction;
const mockDoc = firestoreMock.doc;
const mockCollection = firestoreMock.collection;
const mockGetDoc = firestoreMock.getDoc;
const mockGetDocs = firestoreMock.getDocs;
const mockQuery = firestoreMock.query;
const mockWhere = firestoreMock.where;
const mockOrderBy = firestoreMock.orderBy;
const mockLimit = firestoreMock.limit;
const mockStartAfter = firestoreMock.startAfter;
const mockRunTransaction = firestoreMock.runTransaction;
const mockIncrement = firestoreMock.increment;
const mockServerTimestamp = firestoreMock.serverTimestamp;

import type { Firestore } from "firebase/firestore";

import {
  followUser,
  getFollowCounts,
  getUserProfile,
  isFollowing,
  listUserProfiles,
  unfollowUser,
  upsertUserProfileFromAuth,
} from "../users";

const fakeDb = { __type: "firestore" } as unknown as Firestore;

const buildMockSnapshot = (data: Record<string, unknown> = {}, exists = true) => ({
  exists: () => exists,
  data: () => data,
  id: data.id ?? "mock-id",
});

const fakeUser = {
  uid: "user_1",
  displayName: "Alice Example",
  email: "alice@example.com",
  photoURL: null,
} as const;

beforeEach(() => {
  jest.clearAllMocks();
  mockTransaction.get.mockReset();
  mockTransaction.set.mockReset();
  mockTransaction.update.mockReset();
  mockTransaction.delete.mockReset();

  mockRunTransaction.mockImplementation(async (_db, updater) => updater(mockTransaction));
  mockDoc.mockImplementation((_db, ...segments) => segments.join("/"));
});

describe("user profile helpers (mocked Firestore)", () => {
  it("creates a profile with a sanitized username when none exists", async () => {
    mockTransaction.get.mockResolvedValueOnce(buildMockSnapshot({}, false));

    await upsertUserProfileFromAuth(fakeUser as any, {}, fakeDb);

    expect(mockTransaction.set).toHaveBeenCalledWith(
      "users/user_1",
      expect.objectContaining({
        displayName: "Alice Example",
        username: "aliceexample",
        usernameLowercase: "aliceexample",
      }),
      { merge: true }
    );
  });

  it("preserves existing follower counts when updating a profile", async () => {
    mockTransaction.get.mockResolvedValueOnce(
      buildMockSnapshot({ username: "alice", followersCount: 5, followingCount: 3 })
    );

    await upsertUserProfileFromAuth(fakeUser as any, { bio: "Traveller" }, fakeDb);

    expect(mockTransaction.set).toHaveBeenCalledWith(
      "users/user_1",
      expect.objectContaining({
        bio: "Traveller",
        followersCount: 5,
        followingCount: 3,
      }),
      { merge: true }
    );
  });

  it("follows and unfollows another user with proper counter updates", async () => {
    const followerId = "alpha";
    const followeeId = "bravo";

    mockTransaction.get.mockResolvedValueOnce(buildMockSnapshot({}, false));

    await followUser(followerId, followeeId, fakeDb);

    expect(mockTransaction.set).toHaveBeenCalledWith(
      "userFollows/alpha_bravo",
      expect.objectContaining({
        followerId: "alpha",
        followeeId: "bravo",
      })
    );
    expect(mockTransaction.update).toHaveBeenNthCalledWith(
      1,
      "users/alpha",
      expect.objectContaining({ followingCount: expect.anything(), updatedAt: "timestamp" })
    );
    expect(mockTransaction.update).toHaveBeenNthCalledWith(
      2,
      "users/bravo",
      expect.objectContaining({ followersCount: expect.anything(), updatedAt: "timestamp" })
    );

    mockTransaction.get.mockResolvedValueOnce(buildMockSnapshot({}, true));
    await unfollowUser(followerId, followeeId, fakeDb);

    expect(mockTransaction.delete).toHaveBeenCalledWith("userFollows/alpha_bravo");
  });

  it("checks follow status via isFollowing", async () => {
    mockGetDoc.mockResolvedValueOnce(buildMockSnapshot({}, true));
    await expect(isFollowing("f1", "f2", fakeDb)).resolves.toBe(true);

    mockGetDoc.mockResolvedValueOnce(buildMockSnapshot({}, false));
    await expect(isFollowing("f1", "f2", fakeDb)).resolves.toBe(false);
  });

  it("returns follow counts via getFollowCounts", async () => {
    mockGetDoc.mockResolvedValueOnce(
      buildMockSnapshot({ followersCount: 7, followingCount: 4 }, true)
    );

    await expect(getFollowCounts("userX", fakeDb)).resolves.toEqual({
      followers: 7,
      following: 4,
    });
  });

  it("lists profiles with optional search filtering and pagination data", async () => {
    const mockDocs = [
      {
        id: "userA",
        data: () => ({
          displayName: "User A",
          username: "usera",
          usernameLowercase: "usera",
          followersCount: 1,
          followingCount: 2,
        }),
      },
      {
        id: "userB",
        data: () => ({
          displayName: "User B",
          username: "userb",
          usernameLowercase: "userb",
          followersCount: 3,
          followingCount: 4,
        }),
      },
    ];

    mockGetDocs.mockResolvedValueOnce({ docs: mockDocs });

    const result = await listUserProfiles({ search: "user", excludeUid: "userB" }, fakeDb);

    expect(mockWhere).toHaveBeenCalledWith("usernameLowercase", ">=", "user");
    expect(result.users).toHaveLength(1);
    expect(result.users[0]).toMatchObject({
      id: "userA",
      displayName: "User A",
    });
  });

  it("reads a single user profile via getUserProfile", async () => {
    mockGetDoc.mockResolvedValueOnce(
      buildMockSnapshot({ displayName: "Solo User", username: "solo" }, true)
    );

    const profile = await getUserProfile("solo-id", fakeDb);
    expect(profile).toMatchObject({
      id: "mock-id",
      displayName: "Solo User",
      username: "solo",
    });
  });
});
