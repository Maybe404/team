/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useForm } from "react-hook-form";
import { Button } from "@makeplane/propel/components/button";
import type { IFormattedInstanceConfiguration, TInstanceAIConfigurationKeys } from "@plane/types";
// components
import type { TControllerInputFormField } from "@/components/common/controller-input";
import { ControllerInput } from "@/components/common/controller-input";
import { setToast } from "@plane/blocks/toast";
// hooks
import { useInstance } from "@/hooks/store";

type IInstanceAIForm = {
  config: IFormattedInstanceConfiguration;
};

type AIFormValues = Record<TInstanceAIConfigurationKeys, string>;

export function InstanceAIForm(props: IInstanceAIForm) {
  const { config } = props;
  // store
  const { updateInstanceConfigurations } = useInstance();
  // form data
  const {
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<AIFormValues>({
    defaultValues: {
      LLM_API_KEY: config["LLM_API_KEY"],
      LLM_MODEL: config["LLM_MODEL"],
      LLM_PROVIDER: config["LLM_PROVIDER"] || "openai",
      LLM_BASE_URL: config["LLM_BASE_URL"] || "",
    },
  });

  // [team 二开] 支持 OpenAI 兼容接口（自建模型网关），去掉指向 OpenAI 官网的链接
  const aiFormFields: TControllerInputFormField<AIFormValues>[] = [
    {
      key: "LLM_PROVIDER",
      type: "text",
      label: "Provider",
      description: "openai-compatible for any OpenAI compatible gateway; or openai, anthropic, gemini.",
      placeholder: "openai-compatible",
      error: Boolean(errors.LLM_PROVIDER),
      required: false,
    },
    {
      key: "LLM_BASE_URL",
      type: "text",
      label: "Base URL",
      description: "Chat Completions endpoint root. Leave empty for the official OpenAI API.",
      placeholder: "http://host.docker.internal:3425/v1",
      error: Boolean(errors.LLM_BASE_URL),
      required: false,
    },
    {
      key: "LLM_MODEL",
      type: "text",
      label: "Model",
      description: "Any model name your gateway accepts when the provider is openai-compatible.",
      placeholder: "gpt-4o-mini",
      error: Boolean(errors.LLM_MODEL),
      required: false,
    },
    {
      key: "LLM_API_KEY",
      type: "password",
      label: "API key",
      description: "Sent as the Bearer token.",
      placeholder: "sk-...",
      error: Boolean(errors.LLM_API_KEY),
      required: false,
    },
  ];

  const onSubmit = async (formData: AIFormValues) => {
    const payload: Partial<AIFormValues> = { ...formData };

    await updateInstanceConfigurations(payload)
      .then(() =>
        setToast({
          type: "success",
          title: "Success",
          message: "AI Settings updated successfully",
        })
      )
      .catch((err) => console.error(err));
  };

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <div>
          <div className="pb-1 text-h6-medium text-primary">LLM</div>
          <div className="text-body-sm-regular text-tertiary">Powers the AI assistant in work item descriptions.</div>
        </div>
        <div className="grid-col grid w-full grid-cols-1 items-center justify-between gap-x-12 gap-y-8 lg:grid-cols-2">
          {aiFormFields.map((field) => (
            <ControllerInput
              key={field.key}
              control={control}
              type={field.type}
              name={field.key}
              label={field.label}
              description={field.description}
              placeholder={field.placeholder}
              error={field.error}
              required={field.required}
            />
          ))}
        </div>
      </div>

      <div className="flex flex-col items-start gap-4">
        <Button
          variant="primary"
          size="md"
          stretch="auto"
          onClick={handleSubmit(onSubmit)}
          loading={isSubmitting}
          label={isSubmitting ? "Saving" : "Save changes"}
        />

      </div>
    </div>
  );
}
