FROM public.ecr.aws/lambda/python:3.12
COPY sam/requirements.txt ${LAMBDA_TASK_ROOT}/requirements.txt
RUN python -m pip install --no-cache-dir --only-binary=:all: -r ${LAMBDA_TASK_ROOT}/requirements.txt --target ${LAMBDA_TASK_ROOT}
COPY backend/app ${LAMBDA_TASK_ROOT}/app
CMD ["app.lambda_handler.handler"]
