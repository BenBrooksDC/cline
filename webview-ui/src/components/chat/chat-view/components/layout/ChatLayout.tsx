import type React from "react"
import styled from "styled-components"
import { PanelNewChatButton } from "./PanelNewChatButton"

interface ChatLayoutProps {
	isHidden: boolean
	children: React.ReactNode
}

/**
 * Main layout container for the chat view.
 * Provides the fixed positioning and flex layout structure.
 *
 * LuciBuild fork (T19): renders an always-visible "New Chat" button in the
 * top-right corner of the chat panel (like Claude Code's UI), independent of
 * whether a task is currently active.
 */
export const ChatLayout: React.FC<ChatLayoutProps> = ({ isHidden, children }) => {
	return (
		<ChatLayoutContainer isHidden={isHidden}>
			{!isHidden && <PanelNewChatButton />}
			<MainContent>{children}</MainContent>
		</ChatLayoutContainer>
	)
}

const ChatLayoutContainer = styled.div.withConfig({
	shouldForwardProp: (prop) => !["isHidden"].includes(prop),
})<{ isHidden: boolean }>`
	display: ${(props) => (props.isHidden ? "none" : "grid")};
	grid-template-rows: 1fr auto;
	overflow: hidden;
	padding: 0;
	margin: 0;
	width: 100%;
	height: 100%;
	min-height: 100vh;
	position: relative;
`

const MainContent = styled.div`
	display: flex;
	flex-direction: column;
	overflow: hidden;
	grid-row: 1;
`
