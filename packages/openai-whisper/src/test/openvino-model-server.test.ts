import {expect, test} from 'bun:test';
import {openAiWhisperApiToCaptions} from '../openai-whisper-api-to-captions';

test('OpenVINO Model Server response with text and words only', () => {
	const transcription = {
		text: ' Meet Aura, the wireless headphones.',
		words: [
			{word: ' Meet', start: 0, end: 0.29999998211860657},
			{word: ' Aura,', start: 0.29999998211860657, end: 0.7999999523162842},
			{word: ' the', start: 1.2799999713897705, end: 1.4199999570846558},
			{word: ' wireless', start: 1.4199999570846558, end: 1.7999999523162842},
			{word: ' headphones.', start: 1.7999999523162842, end: 2.4},
		],
	};

	const {captions} = openAiWhisperApiToCaptions({transcription});

	expect(captions.map((c) => c.text)).toEqual([
		' Meet',
		' Aura,',
		' the',
		' wireless',
		' headphones.',
	]);
	expect(captions[1].startMs).toBeCloseTo(300, 3);
	expect(captions[1].endMs).toBeCloseTo(800, 3);
	expect(captions[2].startMs).toBeCloseTo(1280, 3);
});

test('OpenVINO Model Server response without word timestamps is rejected', () => {
	expect(() =>
		openAiWhisperApiToCaptions({transcription: {text: ' Meet Aura.'}}),
	).toThrow();
});
