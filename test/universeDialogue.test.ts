import { describe, expect, it } from 'vitest';
import { generatedCreatures, solarCreatures } from '../universe/game/creatures';
import { ACCEPT, Conversation, MAX_REPLIES, MIN_REPLIES, parseTurn, sanitizeQuest, scriptedTurn, type Exchange } from '../universe/game/dialogue';
import { kill, mission, MissionLog, solarMissions } from '../universe/game/missions';

const world = { system: 'Солнечная система', bodies: ['Земля', 'Луна', 'Марс', 'Нептун'] };
const [oira] = solarCreatures();

describe('creature conversations', () => {
    it('always reaches an errand within the reply limit, whatever the pilot says', () => {
        for (let choice = 0; choice < 4; choice++) {
            for (const creature of solarCreatures()) {
                const history: Exchange[] = [];
                let turn = scriptedTurn(creature, history);
                while (!turn.quest) {
                    expect(turn.options).toHaveLength(4);
                    history.push({ turn, reply: turn.options[choice] });
                    expect(history.length).toBeLessThanOrEqual(MAX_REPLIES);
                    turn = scriptedTurn(creature, history);
                }
                // Talkative: a few exchanges first, and a new line every time.
                expect(history.length).toBeGreaterThanOrEqual(MIN_REPLIES);
                expect(new Set(history.map(h => h.turn.line)).size).toBe(history.length);
                expect(turn.options[0]).toBe(ACCEPT);
                expect(turn.quest.body).toBe(creature.wish.body);
            }
        }
    });

    it('talks to the end without a model (the scripted fallback)', async () => {
        const talk = new Conversation(oira, world);
        expect(talk.offline).toBe(true);
        let turn = await talk.open();
        for (let i = 0; !turn.quest && i < 10; i++) turn = await talk.answer(turn.options[1]);
        expect(turn.quest?.type).toBe('kill');
    });

    it('reads a model reply wrapped in prose and pads the options to four', () => {
        const t = parseTurn('Вот ответ: ```json\n{"line": "Привет, огонёк.", "options": ["Привет", "Дело?"], "quest": null}\n```', world, oira)!;
        expect(t.line).toBe('Привет, огонёк.');
        expect(t.options).toHaveLength(4);
        expect(t.quest).toBeNull();
        expect(parseTurn('no json here', world, oira)).toBeNull();
    });

    it('turns whatever the model offers into an errand the game can run', () => {
        const q = sanitizeQuest({ type: 'kill', enemy: 'dragon', count: 99, body: 'Плутон', reward: 1e6 }, world, oira)!;
        expect(q.enemy).toBe('drone');
        expect(q.count).toBe(12);
        expect(q.body).toBe(oira.home);
        expect(q.reward).toBe(1500);
        expect(sanitizeQuest({ type: 'kill', enemy: 'leviathan', count: 5, body: 'марс' }, world, oira)).toMatchObject({ count: 1, body: 'Марс' });
        expect(sanitizeQuest({ type: 'dance' }, world, oira)).toBeNull();
    });

    it('settles creatures of a generated system on its planets', () => {
        const planets = ['A b', 'A c', 'A d'];
        const list = generatedCreatures(planets, 42);
        expect(list.length).toBeGreaterThan(2);
        for (const c of list) expect(planets).toContain(c.home);
    });
});

it('has ten kinds of creature in the Solar System, each at its own world', () => {
    const list = solarCreatures();
    expect(list).toHaveLength(10);
    expect(new Set(list.map(c => c.kind)).size).toBe(10);
    expect(new Set(list.map(c => c.home)).size).toBe(10);
});

describe('errands', () => {
    it('are open at once, outside the chain of missions', () => {
        const log = new MissionLog(solarMissions());
        const m = log.addSide(mission('side-oira', 'Тишина', '…', 'Луна', [{ kind: 'drone', count: 2 }], [kill('drone', 2)], 400), 0);
        expect(log.unlocked(m)).toBe(true);
        expect(log.active).toBe(m);
        // The chain still opens in order.
        expect(log.unlocked(log.missions[1])).toBe(false);
        log.kill('drone'); log.kill('drone');
        expect(m.state).toBe('done');
        const again = log.addSide(mission('side-oira', 'Ещё', '…', 'Луна', [], [kill('drone', 1)], 100), 1);
        expect(again.id).not.toBe(m.id);
    });
});
