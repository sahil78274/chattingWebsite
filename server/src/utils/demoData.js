import { registerUser } from '../services/authService.js';
import { createMessage, getOrCreateConversation } from '../services/chatService.js';
import logger from './logger.js';

/**
 * Creates the demo accounts used by `npm run seed` and by the demo mode
 * (SEED_DEMO=true with the in-memory store). Never run in production.
 */
export const DEMO_PEOPLE = [
  {
    username: 'aarav.sharma',
    email: 'aarav@example.com',
    displayName: 'Aarav Sharma',
    bio: 'Product designer in Bengaluru. Coffee, cricket and clean interfaces.',
    avatarColor: '#6366f1'
  },
  {
    username: 'priya.nair',
    email: 'priya@example.com',
    displayName: 'Priya Nair',
    bio: 'Backend engineer from Kochi. Currently learning Rust.',
    avatarColor: '#ec4899'
  },
  {
    username: 'rohan_verma',
    email: 'rohan@example.com',
    displayName: 'Rohan Verma',
    bio: 'Delhi based photographer. Ask me about film cameras.',
    avatarColor: '#14b8a6'
  },
  {
    username: 'ananya.iyer',
    email: 'ananya@example.com',
    displayName: 'Ananya Iyer',
    bio: 'Student in Chennai. Always up for a good book recommendation.',
    avatarColor: '#f97316'
  }
];

async function upsertPerson(store, person, password) {
  const existing = await store.findUserByUsername(person.username);
  if (existing) return existing;
  const { user } = await registerUser(store, {
    username: person.username,
    email: person.email,
    password
  });
  return store.updateUser(user._id, {
    displayName: person.displayName,
    bio: person.bio,
    avatarColor: person.avatarColor
  });
}

async function seedConversation(store, from, to, messages) {
  const conversation = await getOrCreateConversation(store, from._id, to._id);
  const existing = await store.listMessages({ conversationId: conversation._id, limit: 1 });
  if (existing.length > 0) return;
  for (const [sender, text] of messages) {
    await createMessage(store, { conversationId: conversation._id, senderId: sender._id, text });
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
}

export async function seedDemoData(store, { password = 'Connectly123' } = {}) {
  const people = [];
  for (const person of DEMO_PEOPLE) {
    people.push(await upsertPerson(store, person, password));
  }
  const [a, p, r, an] = people;

  await seedConversation(store, a, p, [
    [p, 'Hey Aarav! Did you get a chance to look at the onboarding flow?'],
    [a, 'Yes, just finished. The empty states are much clearer now.'],
    [p, 'Great. I pushed the API changes for it this morning.'],
    [a, 'Perfect, I will pull them and check the loading skeletons.'],
    [p, 'Let me know if anything feels slow on mobile.']
  ]);

  await seedConversation(store, a, r, [
    [r, 'The photos from the Delhi meetup are up.'],
    [a, 'Saw them, the portraits came out really well.'],
    [r, 'Thanks! Shot them all on the 50mm.']
  ]);

  await seedConversation(store, p, an, [
    [an, 'Priya, do you have that list of backend interview questions?'],
    [p, 'Sending it tonight. Mostly indexing and caching basics.'],
    [an, 'Thank you!']
  ]);

  logger.info('Demo data ready', { accounts: DEMO_PEOPLE.map((person) => person.username), password });
  return people;
}

export default seedDemoData;
