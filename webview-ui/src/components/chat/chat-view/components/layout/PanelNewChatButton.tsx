import { EmptyRequest } from "@shared/proto/cline/common"
import { PlusIcon } from "lucide-react"
import type React from "react"
import styled from "styled-components"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { TaskServiceClient } from "@/services/grpc-client"

/**
 * LuciBuild fork (T19): always-visible "New Chat" button in the top-right of
 * the chat panel — matches Claude Code's intra-panel + button. Lives inside
 * the webview (not VS Code's title bar) so it's reachable even before a task
 * has started, and so it's positioned where the user expects it visually.
 */
export const PanelNewChatButton: React.FC = () => {
	const onClick = async () => {
		try {
			await TaskServiceClient.clearTask(EmptyRequest.create({}))
		} catch {
			/* no-op — webview side never blocks the user */
		}
	}

	return (
		<FloatingButtonWrapper>
			<Tooltip>
				<TooltipContent side="left">New Chat</TooltipContent>
				<TooltipTrigger asChild>
					<button aria-label="New Chat" onClick={onClick} type="button">
						<PlusIcon size={14} />
					</button>
				</TooltipTrigger>
			</Tooltip>
		</FloatingButtonWrapper>
	)
}

const FloatingButtonWrapper = styled.div`
	position: absolute;
	top: 6px;
	right: 8px;
	z-index: 10;
	display: flex;
	align-items: center;
	justify-content: center;

	button {
		background: transparent;
		border: none;
		color: var(--vscode-foreground);
		opacity: 0.7;
		cursor: pointer;
		padding: 4px 6px;
		border-radius: 4px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		transition: background-color 0.12s, opacity 0.12s;
	}
	button:hover {
		opacity: 1;
		background-color: var(--vscode-toolbar-hoverBackground, rgba(255, 255, 255, 0.08));
	}
	button:active {
		background-color: var(--vscode-toolbar-activeBackground, rgba(255, 255, 255, 0.14));
	}
`
