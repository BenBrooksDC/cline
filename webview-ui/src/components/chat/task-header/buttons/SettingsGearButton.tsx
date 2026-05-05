import { SettingsIcon } from "lucide-react"
import React, { useRef, useState } from "react"
import AutoApproveModal from "@/components/chat/auto-approve-menu/AutoApproveModal"
import { ACTION_METADATA } from "@/components/chat/auto-approve-menu/constants"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

/**
 * Cline-CC fork: per-chat settings gear that opens the AutoApproveModal directly
 * from the task header. Lets the user toggle auto-approval per action without
 * leaving the chat or navigating to the global settings page.
 */
const SettingsGearButton: React.FC<{ className?: string }> = ({ className }) => {
	const [isModalVisible, setIsModalVisible] = useState(false)
	const buttonRef = useRef<HTMLDivElement>(null)

	return (
		<div className="relative" ref={buttonRef}>
			<Tooltip>
				<TooltipContent side="left">Chat settings (auto-approve)</TooltipContent>
				<TooltipTrigger className={cn("flex items-center", className)}>
					<Button
						aria-label="Chat settings"
						onClick={(e) => {
							e.preventDefault()
							e.stopPropagation()
							setIsModalVisible((v) => !v)
						}}
						size="icon"
						variant="icon">
						<SettingsIcon />
					</Button>
				</TooltipTrigger>
			</Tooltip>
			<AutoApproveModal
				ACTION_METADATA={ACTION_METADATA}
				buttonRef={buttonRef}
				isVisible={isModalVisible}
				setIsVisible={setIsModalVisible}
			/>
		</div>
	)
}

export default SettingsGearButton
