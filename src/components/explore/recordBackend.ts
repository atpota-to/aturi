import type { Agent } from '@atproto/api';
import { rkeyFromAtUri } from '@/utils/atproto/urls';
import {
  createSpaceRecord,
  deleteSpaceRecord,
  getSpaceRecord,
  putSpaceRecord,
  type SpaceTransport,
} from '@/utils/atproto/spaceClient';

/**
 * The four record operations <RecordEditor> needs, with the storage behind
 * them left open.
 *
 * A public record and a permissioned one are the same JSON edited through the
 * same form, but they reach different methods on different terms: the public
 * pair is `com.atproto.repo.*` through the agent, the permissioned pair is
 * `com.atproto.space.*` with a space ref threaded through every call. Rather
 * than teach the editor both, each is packaged as one of these.
 *
 * Only the parts that actually differ are behind the interface. The editor
 * still owns the form, the lexicon, the raw-JSON mode, and the delete
 * confirmation, so the two record kinds cannot drift apart in the places a
 * user can see.
 */
export type RecordBackend = {
  /** Read the record's current value. */
  read(collection: string, rkey: string): Promise<Record<string, unknown>>;
  /** Create or overwrite at a known key. */
  put(collection: string, rkey: string, record: Record<string, unknown>): Promise<void>;
  /**
   * Create, letting the host assign a key when `rkey` is absent. Returns the
   * key that was used, and the URI when the host reported one.
   */
  create(
    collection: string,
    record: Record<string, unknown>,
    rkey?: string,
  ): Promise<{ rkey: string | null; uri?: string }>;
  remove(collection: string, rkey: string): Promise<void>;
};

/** Records in a public repo, through the signed-in agent. */
export function repoRecordBackend(agent: Agent, did: string): RecordBackend {
  return {
    async read(collection, rkey) {
      const res = await agent.com.atproto.repo.getRecord({ repo: did, collection, rkey });
      return ((res?.data || res) as { value?: Record<string, unknown> })?.value || {};
    },
    async put(collection, rkey, record) {
      await agent.com.atproto.repo.putRecord({ repo: did, collection, rkey, record });
    },
    async create(collection, record, rkey) {
      if (rkey) {
        await agent.com.atproto.repo.putRecord({ repo: did, collection, rkey, record });
        return { rkey };
      }
      const res = await agent.com.atproto.repo.createRecord({ repo: did, collection, record });
      const data = (res?.data || res) as { uri?: string };
      return { rkey: rkeyFromAtUri(data?.uri || ''), uri: data?.uri };
    },
    async remove(collection, rkey) {
      await agent.com.atproto.repo.deleteRecord({ repo: did, collection, rkey });
    },
  };
}

/**
 * Records in one member's permissioned repo within one space.
 *
 * `transport` must be an OAuth transport and `did` its owner: the space write
 * methods take no other credential, and a PDS treats a write aimed at someone
 * else's repo the way it treats a read of one. The caller is what enforces
 * that, by only building this for the signed-in user's own records.
 *
 * The read goes through the same OAuth transport rather than the credential
 * one a whole-space reader may be holding, so the editor loads exactly the
 * record it is about to write back.
 */
export function spaceRecordBackend(
  transport: SpaceTransport,
  space: string,
  did: string,
  repoHost: string,
): RecordBackend {
  return {
    async read(collection, rkey) {
      const res = await getSpaceRecord(transport, repoHost, {
        space,
        repo: did,
        collection,
        rkey,
      });
      return res.value || {};
    },
    async put(collection, rkey, record) {
      await putSpaceRecord(transport, { space, repo: did, collection, rkey, record });
    },
    async create(collection, record, rkey) {
      const res = await createSpaceRecord(transport, {
        space,
        repo: did,
        collection,
        rkey,
        record,
      });
      return { rkey: rkey ?? rkeyFromAtUri(res.uri || ''), uri: res.uri };
    },
    async remove(collection, rkey) {
      await deleteSpaceRecord(transport, { space, repo: did, collection, rkey });
    },
  };
}
