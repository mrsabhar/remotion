import React from 'react';
import {Grid} from '../../components/TableOfContents/Grid';
import {TOCItem} from '../../components/TableOfContents/TOCItem';

export const TableOfContents: React.FC = () => {
	return (
		<div>
			<Grid>
				<TOCItem link="/docs/openai-whisper/openai-whisper-api-to-captions">
					<strong>{'openAiWhisperApiToCaptions()'}</strong>
					<div>
						Turn OpenAI Whisper API transcriptions into an array of{' '}
						<code>Caption</code>
					</div>
				</TOCItem>
				<TOCItem link="/docs/openai-whisper/is-openai-whisper-transcript">
					<strong>{'isOpenAiWhisperTranscript()'}</strong>
					<div>Recognize OpenAI Whisper transcript signatures</div>
				</TOCItem>
				<TOCItem link="/docs/openai-whisper/openvino-model-server">
					<strong>{'OpenVINO Model Server'}</strong>
					<div>Transcribe locally on Intel hardware and get captions</div>
				</TOCItem>
			</Grid>
		</div>
	);
};
