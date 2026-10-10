FROM public.ecr.aws/lambda/python:3.12
COPY sam/requirements.txt sam/cloud-requirements.txt ${LAMBDA_TASK_ROOT}/
RUN python -m pip install --no-cache-dir --only-binary=:all: -r ${LAMBDA_TASK_ROOT}/cloud-requirements.txt --target ${LAMBDA_TASK_ROOT}
COPY backend/app ${LAMBDA_TASK_ROOT}/app
COPY sample-data/surat-yard.json ${LAMBDA_TASK_ROOT}/sample-data/surat-yard.json
ENV DRYSTOCK_SAMPLE_PATH=/var/task/sample-data/surat-yard.json
CMD ["app.cloud_handler.handler"]
