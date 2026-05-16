import { createMockPublisher } from "../mockPublisher.js";

// Web publish flow remains mock/manual. Real Facebook Page Graph API tests live
// behind the gated shared Meta CLI layer in packages/publishers/meta.
export const facebookPublisher = createMockPublisher("facebook");
