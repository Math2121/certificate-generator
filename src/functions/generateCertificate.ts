import handlebars from "handlebars";
import * as path from "path";
import * as fs from "fs";
import { document } from "src/utils/dynamoDBClient";
import chromium from "chrome-aws-lambda";
import { S3 } from "aws-sdk";

interface ICreateCertificate {
  id: string;
  name: string;
  grade: string;
}
interface ITemplate {
  id: string;
  name: string;
  grade: string;
  date: string;
  medal: string;
}

/**
 * * Compila o html e envia os dados para dentro do template
 */
const compile = async function (data: ITemplate) {
  const filePath = path.join(
    process.cwd(),
    "src",
    "templates",
    "certificate.hbs"
  );

  const html = fs.readFileSync(filePath, "utf-8");
  return handlebars.compile(html)(data);
};

export const handle = async (event) => {
  const { id, name, grade } = JSON.parse(event.body) as ICreateCertificate;

  const res = await document
    .query({
      TableName: "users_certificates",
      KeyConditionExpression: "id = :id",
      ExpressionAttributeValues: {
        ":id": id,
      },
    })
    .promise();

  const userAlreadyExists = res.Items[0];
  if (!userAlreadyExists) {
    await document
      .put({
        TableName: "users_certificates",
        Item: {
          id,
          name,
          grade,
        },
      })
      .promise();
  }

  const medalPath = path.join(process.cwd(), "src", "templates", "selo.png");
  const medal = fs.readFileSync(medalPath, "base64");

  const data: ITemplate = {
    date: new Intl.DateTimeFormat("pt-br").format(new Date()),
    name,
    id,
    grade,
    medal,
  };
  /**
   * * Gera o Certificado
   */
  const content = await compile(data);

  /**
   * * Transforma em PDF
   */

  const browser = await chromium.puppeteer.launch({
    headless: true,
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath,
    ignoreHTTPSErrors: true,
  });

  const page = await browser.newPage();

  await page.setContent(content);

  const pdf = await page.pdf({
    format: "a4",
    landscape: true,
    printBackground: true,
    path: process.env.IS_OFFLINE ? "certificate.pdf" : null,
    preferCSSPageSize: true,
  });

  await browser.close();

  // Salvando no S3
  const s3 = new S3();

  await s3
    .putObject({
      Bucket: "certificate-final",
      Key: `${id}.pdf`,
      ACL: "public-read",
      Body: pdf,
      ContentType: "application/pdf",
    })
    .promise();

  return {
    statusCode: 201,
    body: JSON.stringify({
      message: "Certificate created",
    }),
    headers: {
      "Content-type": "application/json",
    },
  };
};